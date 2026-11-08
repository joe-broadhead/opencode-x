import type { Plugin } from "@opencode/plugin"
import { PARAMETERS } from "./x-tools.js"

/** The rates the cost line uses, in USD, from X's published pay-per-use price. */
const POST = 0.005
const OWNED = 0.001
const USER = 0.01
const COUNT = 0.01

/** Posts the caller owns: X bills these at the owned-read rate. */
const OWNED_TOOLS = new Set([
  "get_users_mentions",
  "get_users_timeline",
  "get_users_posts",
  "get_users_bookmarks",
  "get_users_bookmarks_by_folder_id",
  "get_users_liked_posts",
])
/** Reads that return users, billed per user. */
const USER_TOOLS = new Set([
  "search_users",
  "get_users_by_id",
  "get_users_by_username",
  "get_users_by_usernames",
  "get_users_me_followers",
  "get_users_me_following",
  "get_users_list_memberships",
  "get_users_blocking",
])
/** Reads that return posts, billed per post plus any users X includes. */
const POST_TOOLS = new Set(["search_posts_all", "get_posts_by_id", "get_posts_by_ids"])

export interface ReadCost {
  readonly posts: number
  readonly owned: number
  readonly users: number
  readonly counts: number
  readonly total: number
}

type Result = { content?: string | readonly { type: string; text?: string }[]; output?: unknown }

const nameOf = (tool: string) => (tool.startsWith("x_") ? tool.slice(2) : tool)
const money = (value: number) => {
  const exact = value.toFixed(3)
  return `$${exact.endsWith("0") ? value.toFixed(2) : exact}`
}

/**
 * Caps one billed read before it runs: a page of at most ten, and no next-page token. An absent page size is set to
 * ten, because X's default page can be 100. Expansions are left alone: only the answer knows which it needs, and the
 * skill asks for the ones the answer uses.
 */
export function clampRead(tool: string, input: unknown) {
  const name = nameOf(tool)
  const parameters = PARAMETERS[name]
  if (parameters === undefined || !input || typeof input !== "object") return
  const call = input as Record<string, unknown>
  if (parameters.some((entry) => entry.split(":")[0] === "max_results")) {
    const size = call.max_results
    call.max_results = typeof size === "number" && Number.isFinite(size) && size >= 1 ? Math.min(Math.floor(size), 10) : 10
  }
  delete call.next_token
  delete call.pagination_token
}

const payloadOf = (value: unknown, depth = 0): Record<string, unknown> | undefined => {
  if (depth > 3 || !value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (record.data !== undefined || record.includes !== undefined || record.meta !== undefined) return record
  for (const key of ["structuredContent", "output", "result"]) {
    const found = payloadOf(record[key], depth + 1)
    if (found) return found
  }
  return undefined
}

/** X's answer, `{ data, includes, meta }`, from a result's structured content or its JSON text; undefined for anything else. */
export const payload = (result: Result) => {
  const fromOutput = payloadOf(result.output)
  if (fromOutput) return fromOutput
  const content = result.content
  const texts = typeof content === "string" ? [content] : Array.isArray(content) ? content.filter((part) => part.type === "text").map((part) => part.text ?? "") : []
  for (const text of texts) {
    try {
      const found = payloadOf(JSON.parse(text))
      if (found) return found
    } catch {
      // Not JSON: a plain text result carries no billing detail.
    }
  }
  return undefined
}

const countOf = (value: unknown) => (Array.isArray(value) ? value.length : value && typeof value === "object" ? 1 : 0)

/** The cost of one completed read, from what X actually returned. Missing data means no line, never a guess. */
export function costOf(tool: string, result: Result): ReadCost | undefined {
  const name = nameOf(tool)
  if (name === "get_posts_counts_recent") return { posts: 0, owned: 0, users: 0, counts: 1, total: COUNT }
  const value = payload(result)
  if (!value) return undefined
  if (USER_TOOLS.has(name)) {
    const users = countOf(value.data)
    return { posts: 0, owned: 0, users, counts: 0, total: users * USER }
  }
  if (POST_TOOLS.has(name) || OWNED_TOOLS.has(name)) {
    const posts = countOf(value.data)
    const includes = value.includes && typeof value.includes === "object" ? (value.includes as Record<string, unknown>) : {}
    const users = countOf(includes.users)
    const rate = OWNED_TOOLS.has(name) ? OWNED : POST
    const owned = OWNED_TOOLS.has(name) ? posts : 0
    return { posts: OWNED_TOOLS.has(name) ? 0 : posts, owned, users, counts: 0, total: posts * rate + users * USER }
  }
  return undefined
}

export const mergeCosts = (costs: readonly ReadCost[]): ReadCost => ({
  posts: costs.reduce((sum, cost) => sum + cost.posts, 0),
  owned: costs.reduce((sum, cost) => sum + cost.owned, 0),
  users: costs.reduce((sum, cost) => sum + cost.users, 0),
  counts: costs.reduce((sum, cost) => sum + cost.counts, 0),
  total: costs.reduce((sum, cost) => sum + cost.total, 0),
})

/** One line the model can repeat: what was returned, at its rate, and the actual total. */
export function costLine(cost: ReadCost): string | undefined {
  const parts: string[] = []
  if (cost.posts > 0) parts.push(`${cost.posts} ${cost.posts === 1 ? "post" : "posts"} (${money(cost.posts * POST)})`)
  if (cost.owned > 0) parts.push(`${cost.owned} owned ${cost.owned === 1 ? "post" : "posts"} (${money(cost.owned * OWNED)})`)
  const noun = parts.length > 0 ? (cost.users === 1 ? "author" : "authors") : cost.users === 1 ? "user" : "users"
  if (cost.users > 0) parts.push(`${cost.users} ${noun} (${money(cost.users * USER)})`)
  if (cost.counts > 0) parts.push(`${cost.counts} count ${cost.counts === 1 ? "read" : "reads"} (${money(cost.counts * COUNT)})`)
  return parts.length === 0 ? "Cost: 0 posts + 0 authors = $0.00." : `Cost: ${parts.join(" + ")} = ${money(cost.total)}.`
}

const append = (result: Result, line: string) => {
  const content = result.content
  if (typeof content === "string") result.content = `${content}\n${line}`
  else (result as { content?: unknown }).content = [...(content ?? []), { type: "text", text: line }]
}

/**
 * Registers the read cap and the cost line. `execute.before` can change an MCP call's arguments on the model path and
 * in Code Mode; `execute.after` can add the line to the result. Both were verified on 2.2.3, 2.2.4 and 2.2.5. In Code
 * Mode the inner calls are summed and one line goes on the `execute` result the model reads.
 */
export async function registerBilling(tool: Pick<Plugin.Context["tool"], "hook">, managed: () => boolean) {
  const pending = new Map<string, ReadCost[]>()
  const before = await tool.hook("execute.before", (event) => {
    if (!managed()) return
    if (event.tool === "execute") {
      pending.set(event.sessionID, [])
      return
    }
    if (event.tool.startsWith("x_")) clampRead(event.tool, event.input)
  })
  const after = await tool.hook("execute.after", (event) => {
    if (!managed()) return
    if (event.tool === "execute") {
      const costs = pending.get(event.sessionID) ?? []
      pending.delete(event.sessionID)
      const line = costLine(mergeCosts(costs))
      if (line && event.status === "completed") append(event.result, line)
      return
    }
    if (!event.tool.startsWith("x_") || event.status !== "completed") return
    const cost = costOf(event.tool, event.result)
    if (!cost) return
    const waiting = pending.get(event.sessionID)
    if (waiting) waiting.push(cost)
    else {
      const line = costLine(cost)
      if (line) append(event.result, line)
    }
  })
  return async () => {
    await before.dispose()
    await after.dispose()
  }
}
