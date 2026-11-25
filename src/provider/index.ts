// The X provider: the host's own executors for the vendor's MCP server, one per account alias.
//
// X's hosted MCP server holds the OAuth credential. OpenCode registers one server per alias, named `x` for `default`
// and `x-<alias>` for another, and names each of its tools `<server>_<tool>`. This module looks the executor up by
// those names and runs it with the caller's context, so the session's rules apply and the plugin holds no token. It is
// the one place the endpoint, the scopes and a tool name are written.
import { accountName, redactReason } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { ErrorCode } from "@we-the-rebel-alliance/plugin-contract/events"
import { ProviderError, signInNext, type ServerState, type ServerStatus } from "./errors.js"
import { postsPage, record, text, userOf, type PostsPage, type XResult, type XUser } from "./parse.js"

/** The plugin's name, which derives every server and tool name. */
export const PLUGIN = "x"
/** X's hosted MCP server. Named once, here. */
export const X_ENDPOINT = "https://api.x.com/mcp"
/** The callback X matches exactly. OpenCode listens on this URL's own port. */
export const X_REDIRECT_URI = "http://127.0.0.1:8766/callback"
/**
 * The scopes the plugin asks for. X's 401 names none, so they are pinned; `offline.access` is what makes X issue a
 * refresh token, and the write scopes are what the bookmark, post, Article, media and chat tools need.
 */
export const X_SCOPES: readonly string[] = [
  "tweet.read",
  "users.read",
  "follows.read",
  "like.read",
  "block.read",
  "list.read",
  "list.write",
  "space.read",
  "broadcast.read",
  "calls.read",
  "bookmark.read",
  "bookmark.write",
  "tweet.write",
  "media.write",
  "offline.access",
]

/** The events feeds, in the order a call without a source falls back to. */
export const FEEDS = ["mentions", "bookmarks", "timeline"] as const
export type Feed = (typeof FEEDS)[number]

/** The X read behind each feed. Named once; every handler and manifest operation uses these names. */
export const FEED_TOOL: Readonly<Record<Feed, string>> = {
  mentions: "get_users_mentions",
  bookmarks: "get_users_bookmarks",
  timeline: "get_users_timeline",
}

/** What one read of X returned, for the page's billed cost. */
export interface ReadCounts {
  readonly posts: number
  readonly authors: number
  readonly users: number
}

export const NO_COST: ReadCounts = { posts: 0, authors: 0, users: 0 }

/** One tool the host lists: the vendor's, keyed by its effective name. */
export interface ToolExecutor {
  readonly id: string
  execute(input: unknown, context: unknown): Promise<XResult>
}

/** What the provider needs from the host: the tool list and, for a refusal, the MCP server states. */
export interface ProviderHost {
  readonly tools: { list(): Promise<readonly ToolExecutor[]> }
  readonly servers?: (() => Promise<readonly ServerState[]>) | undefined
}

/** The provider's three reads. A failure is a ProviderError in the contract's form. */
export interface Provider {
  /** Who is signed in for the alias: one billed user read, and no content. */
  me(account: string, call: unknown): Promise<{ readonly user: XUser; readonly cost: ReadCounts }>
  /** One page of a feed. */
  page(account: string, feed: Feed, input: Readonly<Record<string, unknown>>, call: unknown): Promise<PostsPage>
  /** OpenCode's MCP servers, or an empty list when the host has none to read. */
  servers(): Promise<readonly ServerState[]>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const redacted = (value: unknown) => redactReason(value instanceof Error ? value.message : String(value))

/** OpenCode's permission refusals, which must reach the register unchanged so it answers PERMISSION_DENIED. */
const permissionTag = (tag: unknown) => typeof tag === "string" && tag.startsWith("Permission.")

/** What the host says about an alias's server: a state, "unknown" when the list could not be read, or no entry. */
type ServerLookup = ServerState | "unknown" | undefined

/** The refusal for one tool that could not run, with its first line cut and redacted. */
function failure(tool: string, error: unknown, server: string, state: ServerLookup): ProviderError {
  if (permissionTag(isRecord(error) ? error["_tag"] : undefined)) throw error
  // A Tool.Error with a cause is a refused permission check, not X's own failure (4a's host behaviour).
  if (isRecord(error) && error["_tag"] === "Tool.Error" && error["error"] !== undefined) throw error
  const message = redacted(error)
  const lowered = message.toLowerCase()
  const next = (code: ErrorCode): string =>
    code === "NEEDS_SIGN_IN"
      ? signInNext(typeof state === "object" ? state.name : server)
      : code === "RATE_LIMITED"
        ? "Wait a short while, then call the method again."
        : code === "SCOPE_MISSING"
          ? "Add the scope to the X app and sign in to that account again."
          : "Read the plugin's status, then call the method again."
  const code: ErrorCode = /(?:^|\D)429\b|rate limit|too many requests/.test(lowered)
    ? "RATE_LIMITED"
    : /(?:^|\D)401\b|unauthori[sz]ed|invalid[ _-]?token|token (?:expired|has expired|refresh)|needs[ _-]?auth|sign[ -]?in required|credential/.test(lowered)
      ? "NEEDS_SIGN_IN"
      : /(?:^|\D)403\b|forbidden|scope/.test(lowered)
        ? "SCOPE_MISSING"
        : "UNAVAILABLE"
  return new ProviderError(code, `X's ${tool} failed: ${message}`, next(code))
}

/** The refusal for a server that is not there, one the host cannot list, or one it says needs attention. */
function unreachable(tool: string, server: string, state: ServerLookup): ProviderError {
  if (state === "unknown") {
    return new ProviderError("UNAVAILABLE", `OpenCode could not list its MCP servers, so whether X's ${server} is available is unknown`, `Read the plugin's status, then call the method again.`)
  }
  if (state === undefined) {
    return new ProviderError("UNAVAILABLE", `OpenCode lists no X MCP server named ${server}, so ${tool} cannot run`, `Add the ${server} MCP server, sign in, then read the status.`)
  }
  if (state.status === "needs_auth") {
    return new ProviderError("NEEDS_SIGN_IN", `X's ${server} needs a sign-in: ${redacted(state.error ?? "the credential was refused")}`, signInNext(server))
  }
  if (state.status === "disabled") {
    return new ProviderError("UNAVAILABLE", `the ${server} MCP server is disabled, so ${tool} cannot run`, `Enable ${server} in the person's MCP settings.`)
  }
  if (state.status === "failed") {
    return new ProviderError("UNAVAILABLE", `the ${server} MCP server failed: ${redacted(state.error ?? "the host gave no reason")}`, `Check the connection, then read the status.`)
  }
  return new ProviderError("UNAVAILABLE", `OpenCode has no X tool ${server}_${tool}, so the read cannot run`, `Wait for ${server} to finish connecting, then read the status.`)
}

/** The provider over one plugin context. */
export function createProvider(host: ProviderHost): Provider {
  const serverOf = (account: string) => accountName(PLUGIN, account)

  async function states(): Promise<readonly ServerState[]> {
    if (host.servers === undefined) return []
    return host.servers()
  }

  async function stateOf(account: string): Promise<ServerLookup> {
    const name = serverOf(account)
    let listed: readonly ServerState[]
    try {
      listed = await states()
    } catch {
      return "unknown"
    }
    return listed.find((entry) => entry.name === name)
  }

  /** Run one X tool as the caller, through the host's own executor for the alias's server. */
  async function execute(account: string, tool: string, input: Readonly<Record<string, unknown>>, call: unknown): Promise<XResult> {
    const context = call as { readonly signal: AbortSignal }
    context.signal.throwIfAborted()
    const server = serverOf(account)
    const id = `${server}_${tool}`
    const executor = (await host.tools.list()).find((entry) => entry.id === id)
    // A cancellation can land while the list is in flight, before any executor exists to abort.
    context.signal.throwIfAborted()
    if (executor === undefined) throw unreachable(tool, server, await stateOf(account))
    try {
      const result = await executor.execute(input, call)
      context.signal.throwIfAborted()
      return result
    } catch (error) {
      if (context.signal.aborted) throw error
      throw failure(tool, error, server, await stateOf(account))
    }
  }

  return {
    async me(account, call) {
      const response = await execute(account, "get_users_me", { "user.fields": "username,name" }, call)
      const user = userOf("get_users_me", response)
      return { user, cost: { posts: 0, authors: 0, users: 1 } }
    },

    async page(account, feed, input, call) {
      const tool = FEED_TOOL[feed]
      return postsPage(tool, await execute(account, tool, input, call))
    },

    servers: states,
  }
}

/** The MCP servers `ctx.mcp.list()` reports, narrowed to the fields the plugin reads. */
export function serverStates(list: unknown): readonly ServerState[] {
  const output = record(list)
  const data = Array.isArray(output["data"]) ? output["data"] : []
  const statuses: readonly ServerStatus[] = ["connected", "pending", "disabled", "failed", "needs_auth"]
  return data.flatMap((entry): ServerState[] => {
    const server = record(entry)
    const name = text(server["name"])
    const status = text(server["status"])
    if (name === undefined || status === undefined || !(statuses as readonly string[]).includes(status)) return []
    const error = text(server["error"])
    return [{ name, status: status as ServerStatus, ...(error === undefined ? {} : { error }) }]
  })
}
