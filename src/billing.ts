import type { Plugin } from "@opencode/plugin"
import { PARAMETERS } from "./x-tools.js"
import { priceOf, type MethodPrice, type ResourceKind } from "./prices.js"

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
const OWNED_USER_TOOLS = new Set(["get_users_me_followers", "get_users_me_following", "get_users_blocking"])
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

export type CostBasis = "conservative" | "owned"

export interface ReadCost {
  readonly posts: number
  readonly owned: number
  readonly users: number
  readonly counts: number
  readonly total: number
  readonly basis: CostBasis
  readonly ownedRate: number
  readonly userRate: number
}

type Result = { content?: string | readonly { type: string; text?: string }[]; output?: unknown }

const nameOf = (tool: string) => (tool.startsWith("x_") ? tool.slice(2) : tool)
const exact = (value: number) => Math.round(value * 1e6) / 1e6
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

/** The per-session spend budget a script gets, in USD, until the plugin's `scriptBudgetUsd` option sets it. */
export const DEFAULT_SCRIPT_BUDGET_USD = 1

/**
 * The script path's shape for a billed read: X's own maximum page of 100, and the next-page token as the script wrote
 * it, because the user approved the script's code. The model path's ten-result cap and token strip are unchanged, in
 * `clampRead`.
 */
export function widenRead(tool: string, input: unknown) {
  const name = nameOf(tool)
  const parameters = PARAMETERS[name]
  if (parameters === undefined || !input || typeof input !== "object") return
  const call = input as Record<string, unknown>
  if (!parameters.some((entry) => entry.split(":")[0] === "max_results")) return
  const size = call.max_results
  if (typeof size !== "number" || !Number.isFinite(size)) return
  call.max_results = Math.min(Math.max(1, Math.floor(size)), 100)
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

const payload = (result: Result) => {
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
export function costOf(tool: string, result: Result, owns = ownsXApp): ReadCost | undefined {
  const name = nameOf(tool)
  if (name === "get_posts_counts_recent") return { posts: 0, owned: 0, users: 0, counts: 1, total: COUNT, basis: "conservative", ownedRate: OWNED, userRate: USER }
  const value = payload(result)
  if (!value) return undefined
  if (USER_TOOLS.has(name)) {
    const users = countOf(value.data)
    const owned = OWNED_USER_TOOLS.has(name) && owns
    const userRate = owned ? OWNED : USER
    return { posts: 0, owned: 0, users, counts: 0, total: users * userRate, basis: owned ? "owned" : "conservative", ownedRate: OWNED, userRate }
  }
  if (POST_TOOLS.has(name) || OWNED_TOOLS.has(name)) {
    const posts = countOf(value.data)
    const includes = value.includes && typeof value.includes === "object" ? (value.includes as Record<string, unknown>) : {}
    const users = countOf(includes.users)
    const owned = OWNED_TOOLS.has(name) && owns
    const rate = owned ? OWNED : POST
    return { posts: OWNED_TOOLS.has(name) ? 0 : posts, owned: OWNED_TOOLS.has(name) ? posts : 0, users, counts: 0, total: posts * rate + users * USER, basis: owned ? "owned" : "conservative", ownedRate: rate, userRate: USER }
  }
  return undefined
}

/** A tools-RPC result's billed cost, read by the same rules: its structured content, or its text when it has none. */
export function scriptCostOf(tool: string, result: { readonly output?: unknown; readonly text: string }): ReadCost | undefined {
  return costOf(tool, { content: result.text, ...(result.output === undefined ? {} : { output: result.output }) })
}

export const mergeCosts = (costs: readonly ReadCost[]): ReadCost => ({
  posts: costs.reduce((sum, cost) => sum + cost.posts, 0),
  owned: costs.reduce((sum, cost) => sum + cost.owned, 0),
  users: costs.reduce((sum, cost) => sum + cost.users, 0),
  counts: costs.reduce((sum, cost) => sum + cost.counts, 0),
  total: costs.reduce((sum, cost) => sum + cost.total, 0),
  basis: costs.length > 0 && costs.every((cost) => cost.basis === "owned") ? "owned" : "conservative",
  ownedRate: costs.length > 0 && costs.every((cost) => cost.basis === "owned") ? OWNED : POST,
  userRate: USER,
})

/** One line the model can repeat: what was returned, at its rate, and the actual total. */
export function costLine(cost: ReadCost): string {
  const atMost = cost.basis === "conservative" ? "at most " : ""
  const parts: string[] = []
  if (cost.posts > 0) parts.push(`${cost.posts} ${cost.posts === 1 ? "post" : "posts"} (${money(cost.posts * POST)})`)
  if (cost.owned > 0) parts.push(`${cost.owned} owned ${cost.owned === 1 ? "post" : "posts"} (${money(cost.owned * cost.ownedRate)})`)
  const noun = parts.length > 0 ? (cost.users === 1 ? "author" : "authors") : cost.users === 1 ? "user" : "users"
  if (cost.users > 0) parts.push(`${cost.users} ${noun} (${money(cost.users * cost.userRate)})`)
  if (cost.counts > 0) parts.push(`${cost.counts} count ${cost.counts === 1 ? "read" : "reads"} (${money(cost.counts * COUNT)})`)
  return parts.length === 0 ? "Cost: 0 posts + 0 authors = $0.00." : `Cost: ${atMost}${parts.join(" + ")} = ${money(cost.total)}.`
}

const append = (result: Result, line: string) => {
  const content = result.content
  if (typeof content === "string") result.content = `${content}\n${line}`
  else (result as { content?: unknown }).content = [...(content ?? []), { type: "text", text: line }]
}

/**
 * Registers the read cap and the cost line. `execute.before` can change an MCP call's arguments on the model path and
 * in Code Mode; `execute.after` can add the line to the result. Both were verified on 2.2.3, 2.2.4, 2.2.5 and 2.2.6. In Code
 * Mode the inner calls are summed and one line goes on the `execute` result the model reads.
 */
export async function registerBilling(tool: Pick<Plugin.Context["tool"], "hook">, managed: () => boolean, owns = ownsXApp) {
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
      // Only an execute that made a billed X call gets a line; one that made none is left as it is.
      if (costs.length === 0) return
      const merged = mergeCosts(costs)
      if (merged.total > 0) recordDaily(merged.total)
      if (event.status === "completed") append(event.result, costLine(merged))
      return
    }
    if (!event.tool.startsWith("x_") || event.status !== "completed") return
    const cost = costOf(event.tool, event.result, owns)
    if (!cost) return
    const waiting = pending.get(event.sessionID)
    if (waiting) waiting.push(cost)
    else {
      recordDaily(cost.total)
      append(event.result, costLine(cost))
    }
  })
  return async () => {
    await before.dispose()
    await after.dispose()
  }
}

/** The daily cap a script gets, across sessions and reloads, in USD, until the plugin's option sets it. */
export const DEFAULT_SCRIPT_DAILY_BUDGET_USD = 1

/** The rolling window of the daily ledger: 24 hours. */
const DAY_MS = 24 * 60 * 60 * 1000
const LEDGER_KEY = "billing.ledger.v1"

type LedgerEntry = { readonly at: number; readonly usd: number }
type LedgerStorage = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }

let storage: LedgerStorage | undefined
let sessionBudgetUsd = DEFAULT_SCRIPT_BUDGET_USD
let dailyBudgetUsd = DEFAULT_SCRIPT_DAILY_BUDGET_USD
let ledger: LedgerEntry[] = []
let writing = Promise.resolve()
const scriptSpent = new Map<string, number>()
const estimates = new Map<string, CallEstimate>()
/** Set only when the signed-in account owns the developer app; otherwise the standard price is used. */
let ownsXApp = false

const prune = (entries: LedgerEntry[], now = Date.now()) => entries.filter((entry) => entry.at > now - DAY_MS && entry.usd > 0)

/** Loads the persisted ledger and sets both caps. Called once at setup, before any call. */
export async function configureBilling(input: { readonly storage?: LedgerStorage; readonly sessionBudgetUsd: number; readonly dailyBudgetUsd: number; readonly ownsXApp?: boolean }) {
  storage = input.storage
  sessionBudgetUsd = input.sessionBudgetUsd
  dailyBudgetUsd = input.dailyBudgetUsd
  ownsXApp = input.ownsXApp === true
  const saved = await storage?.get(LEDGER_KEY).catch(() => undefined)
  const entries = saved && typeof saved === "object" && Array.isArray((saved as { entries?: unknown }).entries) ? ((saved as { entries: unknown[] }).entries ?? []) : []
  ledger = prune(entries.flatMap((entry) => (entry && typeof entry === "object" && typeof (entry as LedgerEntry).at === "number" && typeof (entry as LedgerEntry).usd === "number" ? [entry as LedgerEntry] : [])))
}

/** The spend in the rolling 24-hour window, and both caps, for status. */
export function billingStatus() {
  return { dailySpentUsd: dailySpent(), dailyBudgetUsd, sessionBudgetUsd }
}

const dailySpent = (now = Date.now()) => {
  ledger = prune(ledger, now)
  return exact(ledger.reduce((sum, entry) => sum + entry.usd, 0))
}

const save = () => {
  writing = writing.then(() => storage?.set(LEDGER_KEY, { entries: ledger }).catch(() => undefined)).then(() => undefined)
  return writing
}

/** Awaits the last ledger write; tests use it so a simulated reload sees the spend. */
export const flushBilling = () => writing

const recordDaily = (usd: number) => {
  if (usd <= 0) return
  ledger.push({ at: Date.now(), usd: exact(usd) })
  void save()
}

/** The session's spend and the rolling daily spend, both in USD. */
export const spentOf = (sessionID: string) => ({ sessionSpentUsd: scriptSpent.get(sessionID) ?? 0, dailySpentUsd: dailySpent() })

export interface CallEstimate {
  readonly method: string
  readonly pageSize: number
  readonly estimateUsd: number
  readonly price: MethodPrice
}

/** A method the table does not price. The script path refuses it rather than run for free. */
export class PriceUnknownError extends Error {
  readonly method: string
  constructor(method: string) {
    super(`${method} has no published X price`)
    this.method = method
  }
}

/** An estimate that does not fit the session or the rolling daily cap. Refused before dispatch. */
export class BudgetExceededError extends Error {
  readonly estimateUsd: number
  readonly sessionSpentUsd: number
  readonly sessionBudgetUsd: number
  readonly dailySpentUsd: number
  readonly dailyBudgetUsd: number
  constructor(input: { estimateUsd: number; sessionSpentUsd: number; sessionBudgetUsd: number; dailySpentUsd: number; dailyBudgetUsd: number }) {
    super(`the call is estimated at $${input.estimateUsd.toFixed(2)}, above the remaining X budget`)
    this.estimateUsd = input.estimateUsd
    this.sessionSpentUsd = input.sessionSpentUsd
    this.sessionBudgetUsd = input.sessionBudgetUsd
    this.dailySpentUsd = input.dailySpentUsd
    this.dailyBudgetUsd = input.dailyBudgetUsd
  }
}

/** The rate actually used: the Owned Read price only when the option says the account owns the app. */
const rateFor = (price: { readonly perResourceUsd: number; readonly ownedUsd?: number }, owns = ownsXApp) => (owns && price.ownedUsd !== undefined ? price.ownedUsd : price.perResourceUsd)
const basisFor = (price: { readonly ownedUsd?: number }, owns = ownsXApp): CostBasis => (owns && price.ownedUsd !== undefined ? "owned" : "conservative")

const pageSizeOf = (method: string, input: unknown) => {
  if (!input || typeof input !== "object") return 1
  const call = input as Record<string, unknown>
  const parameters = PARAMETERS[method] ?? []
  const key = ["max_results", "max_trends"].find((name) => parameters.some((entry) => entry.split(":")[0] === name))
  const size = key === undefined ? undefined : call[key]
  return typeof size === "number" && Number.isFinite(size) && size >= 1 ? Math.floor(size) : 1
}

const hasUrl = (input: unknown) => {
  const text = input && typeof input === "object" ? (input as Record<string, unknown>).text : undefined
  return typeof text === "string" && /https?:\/\//i.test(text)
}

/** The pre-call estimate: the page size times the resource rate, plus any per-request price. */
export function estimateCall(method: string, input: unknown, owns = ownsXApp): CallEstimate {
  const price = priceOf(method)
  if (price === undefined) throw new PriceUnknownError(method)
  if (price.kind === "request") return { method, pageSize: 1, estimateUsd: exact(price.perRequestUsd), price }
  if (price.kind === "postCreate") return { method, pageSize: 1, estimateUsd: exact(hasUrl(input) ? price.withUrlUsd : price.perRequestUsd), price }
  const pageSize = pageSizeOf(method, input)
  return { method, pageSize, estimateUsd: exact(pageSize * rateFor(price, owns)), price }
}

/** Refuses before dispatch when the estimate does not fit the session or daily cap. */
export function assertBudget(sessionID: string, estimateUsd: number) {
  const sessionSpentUsd = scriptSpent.get(sessionID) ?? 0
  const dailySpentUsd = dailySpent()
  const fitsSession = sessionSpentUsd + estimateUsd <= sessionBudgetUsd + 1e-9
  const fitsDaily = dailySpentUsd + estimateUsd <= dailyBudgetUsd + 1e-9
  if (!fitsSession || !fitsDaily) throw new BudgetExceededError({ estimateUsd, sessionSpentUsd, sessionBudgetUsd, dailySpentUsd, dailyBudgetUsd })
}

const countResources = (value: unknown) => (Array.isArray(value) ? value.length : value && typeof value === "object" ? 1 : 0)

const resourceLine = (kind: ResourceKind, count: number, usd: number) => {
  const names: Record<ResourceKind, [string, string]> = {
    post: ["post", "posts"],
    user: ["user", "users"],
    list: ["list", "lists"],
    space: ["Space", "Spaces"],
    community: ["Community", "Communities"],
    news: ["news item", "news items"],
    dm: ["message", "messages"],
  }
  return `${count} ${count === 1 ? names[kind][0] : names[kind][1]} (${money(usd)})`
}

const requestLine = (method: string, count: number, usd: number) => {
  const label = method === "get_posts_counts_recent" ? "counts read" : method === "get_trends_by_woeid" ? "trends read" : "request"
  return `${count} ${label}${count === 1 ? "" : "s"} (${money(usd)})`
}

/** The actual cost of one completed script call, from what X returned; the estimate when it reports no usage. */
export function scriptCostOfCall(method: string, _input: unknown, result: { readonly output?: unknown; readonly text: string }, estimate: CallEstimate, owns = ownsXApp): { actualUsd: number; line: string; resourceCount: number; basis: CostBasis } {
  const price = estimate.price
  const basis = price.kind === "request" || price.kind === "postCreate" ? "conservative" : basisFor(price, owns)
  const atMost = basis === "conservative" ? "at most " : ""
  if (price.kind === "request") return { actualUsd: exact(price.perRequestUsd), line: `Cost: ${atMost}${requestLine(method, 1, price.perRequestUsd)} = ${money(price.perRequestUsd)}.`, resourceCount: 1, basis }
  if (price.kind === "postCreate") {
    const usd = estimate.estimateUsd
    return { actualUsd: usd, line: `Cost: ${atMost}1 post (${money(usd)}) = ${money(usd)}.`, resourceCount: 1, basis }
  }
  const rate = rateFor(price, owns)
  const value = payload(result)
  if (!value) return { actualUsd: estimate.estimateUsd, line: `Cost: ${atMost}${resourceLine(price.kind, estimate.pageSize, estimate.estimateUsd)} = ${money(estimate.estimateUsd)}.`, resourceCount: estimate.pageSize, basis }
  const count = countResources(value.data)
  const includes = value.includes && typeof value.includes === "object" ? (value.includes as Record<string, unknown>) : {}
  const users = price.kind === "post" && typeof includes.users !== "undefined" ? countResources(includes.users) : 0
  const usd = exact(count * rate + (price.kind === "post" ? users * 0.01 : 0))
  const parts = [resourceLine(price.kind, count, count * rate)]
  if (users > 0) parts.push(`${users} ${users === 1 ? "author" : "authors"} (${money(users * 0.01)})`)
  const line = count === 0 && users === 0 ? "Cost: 0 posts + 0 authors = $0.00." : `Cost: ${atMost}${parts.join(" + ")} = ${money(usd)}.`
  return { actualUsd: usd, line, resourceCount: count + users, basis }
}

/** Remembers the estimate for the call whose result follows, so the actual can fall back to it. */
export function rememberEstimate(sessionID: string, estimate: CallEstimate) {
  estimates.set(sessionID, estimate)
}

/** Takes the remembered estimate for a session, once. */
export function takeEstimate(sessionID: string): CallEstimate | undefined {
  const estimate = estimates.get(sessionID)
  estimates.delete(sessionID)
  return estimate
}

/** Clears the in-memory session spend and the daily ledger; the tests use it. */
export function resetBilling() {
  scriptSpent.clear()
  ledger = []
  ownsXApp = false
  void save()
}

/** Records the actual spend after a call: the session sum and the rolling daily ledger. */
export function recordCall(sessionID: string, usd: number) {
  // A long-lived server must not keep one entry per script session forever: cap the map at 1000 sessions.
  if (!scriptSpent.has(sessionID) && scriptSpent.size >= 1_000) {
    const oldest = scriptSpent.keys().next().value
    if (oldest !== undefined) scriptSpent.delete(oldest)
  }
  scriptSpent.set(sessionID, exact((scriptSpent.get(sessionID) ?? 0) + usd))
  recordDaily(usd)
}

/** The model path's own cost also counts toward the daily ledger. */
export const recordModelCost = (usd: number) => recordDaily(usd)
