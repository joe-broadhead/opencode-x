// X's answers, read from the host's MCP tool result.
//
// The vendor's MCP server owns the protocol; this module only reads the JSON it returns. A result carries the answer
// in `output` when the host structured it, or as JSON text in its content parts, which is what an MCP server's text
// result is. Nothing here throws a host error: an answer this module cannot read becomes a ProviderError the handler
// turns into a contract refusal, and a credential is never copied into a message.
import { ProviderError } from "./errors.js"

/** What the host's MCP tool executor returns, as much of it as this module reads. */
export interface XResult {
  readonly content?: string | readonly { readonly type?: string; readonly text?: string }[]
  readonly output?: unknown
}

/** X's answer to a v2 read: `data`, `includes` and `meta`. */
export type XPayload = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
export const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})
export const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined)

/** X's answer from a structured output or its JSON text; undefined when neither holds one. */
function payloadAt(value: unknown, depth = 0): XPayload | undefined {
  if (depth > 3 || !isRecord(value)) return undefined
  if (value["data"] !== undefined || value["includes"] !== undefined || value["meta"] !== undefined || value["errors"] !== undefined) return value
  for (const key of ["structuredContent", "output", "result"]) {
    const found = payloadAt(value[key], depth + 1)
    if (found) return found
  }
  return undefined
}

/** X's answer, from the result's structured output or its text parts. */
export function payload(result: XResult): XPayload | undefined {
  const fromOutput = payloadAt(result.output)
  if (fromOutput) return fromOutput
  const content = result.content
  const texts = typeof content === "string" ? [content] : Array.isArray(content) ? content.flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])) : []
  for (const value of texts) {
    try {
      const found = payloadAt(JSON.parse(value) as unknown)
      if (found) return found
    } catch {
      // A plain text result carries no answer this module reads.
    }
  }
  return undefined
}

/** X's own failure in an answer that holds only `errors`, as a refusal naming the tool and its first line. */
export function upstreamFailure(tool: string, value: XPayload): ProviderError | undefined {
  const errors = Array.isArray(value["errors"]) ? value["errors"].map(record) : []
  if (value["data"] !== undefined || value["meta"] !== undefined || errors.length === 0) return undefined
  const first = errors[0] ?? {}
  const detail = text(first["detail"]) ?? text(first["title"]) ?? text(first["message"]) ?? "no detail"
  return new ProviderError("UNAVAILABLE", `X's ${tool} failed: ${detail}`, "Read the account's status, then call the method again.")
}

/** X's `get_users_me` or `get_users_by_username` answer: one user's id and handle. */
export interface XUser {
  readonly id: string
  readonly username: string
  readonly name?: string
}

const SNOWFLAKE = /^\d{1,19}$/
const HANDLE = /^\w{1,50}$/

/** One user from a user read, or a ProviderError when the answer is not one. */
export function userOf(tool: string, response: XResult): XUser {
  const value = payload(response)
  const failure = value === undefined ? undefined : upstreamFailure(tool, value)
  if (failure) throw failure
  if (value === undefined) throw unreadable(tool)
  const data = record(value["data"])
  const id = text(data["id"])
  const username = text(data["username"])
  const name = text(data["name"])
  if (id === undefined || !SNOWFLAKE.test(id) || username === undefined || !HANDLE.test(username)) throw unreadable(tool)
  return { id, username, ...(name === undefined ? {} : { name }) }
}

/** One post of a timeline, mentions or bookmarks answer. */
export interface Post {
  readonly id: string
  readonly text: string
  readonly created: number
  readonly conversation?: string
  readonly author?: { readonly id: string; readonly username?: string; readonly name?: string }
}

/** One page of a read: its posts, the next page's token, and how many posts and users X returned for the bill. */
export interface PostsPage {
  readonly posts: readonly Post[]
  readonly next?: string
  readonly posts_read: number
  readonly authors_read: number
}

/** One page of X's answer, or a ProviderError when the answer is not one. */
export function postsPage(tool: string, response: XResult): PostsPage {
  const value = payload(response)
  if (value === undefined) throw unreadable(tool)
  const failure = upstreamFailure(tool, value)
  if (failure) throw failure
  const data = value["data"]
  if (data !== undefined && !Array.isArray(data)) throw unreadable(tool)
  const includes = record(value["includes"])
  const users = new Map(
    (Array.isArray(includes["users"]) ? includes["users"] : []).flatMap((entry) => {
      const user = record(entry)
      const id = text(user["id"])
      if (id === undefined) return []
      const username = text(user["username"])
      const name = text(user["name"])
      return [[id, { ...(username === undefined ? {} : { username }), ...(name === undefined ? {} : { name }) }] as const]
    }),
  )
  const posts = ((data as unknown[] | undefined) ?? []).flatMap((entry): Post[] => {
    const post = record(entry)
    const id = text(post["id"])
    const created = Date.parse(String(post["created_at"]))
    if (id === undefined || !SNOWFLAKE.test(id) || !Number.isFinite(created)) return []
    const authorId = text(post["author_id"])
    const user = authorId === undefined ? undefined : users.get(authorId)
    const conversation = text(post["conversation_id"])
    return [
      {
        id,
        text: text(record(post["note_tweet"])["text"]) ?? text(post["text"]) ?? "",
        created,
        ...(conversation === undefined ? {} : { conversation }),
        ...(authorId === undefined
          ? {}
          : {
              author: {
                id: authorId,
                ...(user?.username === undefined ? {} : { username: user.username }),
                ...(user?.name === undefined ? {} : { name: user.name }),
              },
            }),
      },
    ]
  })
  const next = text(record(value["meta"])["next_token"])
  return {
    posts,
    ...(next === undefined ? {} : { next }),
    posts_read: Array.isArray(data) ? data.length : 0,
    authors_read: Array.isArray(includes["users"]) ? includes["users"].length : 0,
  }
}

/** The refusal for an answer in a shape this module does not read. It names the tool, never the answer. */
export function unreadable(tool: string): ProviderError {
  return new ProviderError(
    "UNAVAILABLE",
    `X's ${tool} answered in a shape this plugin does not read`,
    `Call ${tool} directly to see X's answer, then read the plugin's status.`,
  )
}
