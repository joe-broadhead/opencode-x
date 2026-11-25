// One events feed: X's page walk, the cursor state each feed keeps, and the events it lists.
//
// Mentions and the home timeline are read newest first by `since_id` (or `start_time` on a first listing); bookmarks
// have no `since_id`, so they are walked newest first until a bookmark the cursor knows. Either way the events are
// listed oldest first, and a window a call cannot finish is narrowed for the next call instead of being skipped: the
// cursor holds each feed's own position, bound to the plugin, the feed and the account.
import { fitPage, makeEvent, type EventsGap, type SourceEvent } from "@we-the-rebel-alliance/plugin-contract/events"
import type { Provider, ReadCounts } from "../provider/index.js"
import type { Feed } from "../provider/index.js"
import type { Post, XUser } from "../provider/parse.js"

/** X's largest page for these reads. */
const PAGE_SIZE = 100
/** The bookmark read's page size: small enough that one page's events always fit a page's bytes. */
const BOOKMARK_PAGE = 50
/** The newest known bookmarks a cursor keeps, so one removed bookmark does not restart the walk. */
const KNOWN_BOOKMARKS = 5
/** X lists only a user's 800 most recent bookmarks (X staff, on X's developer forum). */
const BOOKMARK_REACH = 800
/** X may count toward its 800 bookmarks posts it no longer returns, so a shorter walk still counts as reaching the end. */
const BOOKMARK_MARGIN = 100
const X_EARLIEST = Date.parse("2010-11-06T00:00:01Z")
const FIELDS = {
  expansions: "author_id",
  "post.fields": "created_at,author_id,conversation_id,text,note_tweet",
  "user.fields": "username,name",
}
const POST_ID = /^\d{1,19}$/
const LABELS: Readonly<Record<Feed, string>> = { mentions: "mention", bookmarks: "bookmark", timeline: "timeline" }
const byId = (left: { readonly id: string }, right: { readonly id: string }) => (BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0)
export const iso = (time: number) => new Date(time).toISOString()

/** Where a timeline or mentions feed stands: after post `s`, from time `t` before any, below `u` while a window is narrowed, and `w` the newest post it listed. */
export interface WindowState {
  readonly p?: string
  readonly t?: number
  readonly u?: string
  readonly w?: number
  /** Set while a narrowed window sits above an earlier walk that discarded newer posts. */
  readonly d?: 1
}

/** Where bookmarks stand: the newest known `k`, the first start `t`, a resumed walk `r` with its first ids `n`, and `w` when the known ones were confirmed. */
export interface BookmarkState {
  readonly k?: readonly string[]
  readonly t?: number
  readonly r?: string
  readonly n?: readonly string[]
  readonly w?: number
}

export type FeedState = WindowState | BookmarkState

/** What one call's walk answers: the next cursor state, the events it may list, and what X returned for its reads. */
export interface FeedRead {
  readonly state: FeedState
  readonly events: readonly SourceEvent[]
  readonly more: boolean
  readonly gap?: EventsGap
  readonly cost: ReadCounts
}

/** One feed's walk inputs: who is signed in, where it stands, and what a call may spend. */
export interface FeedWalk {
  readonly provider: Provider
  readonly account: string
  readonly feed: Feed
  readonly me: XUser
  readonly state: FeedState
  /** The first listing's start, already resolved from `since` or the default 24 hours. */
  readonly since: number
  readonly limit: number
  readonly maxBytes: number
  /** The most X reads this call makes, the account lookup included; one is already spent on `me`. */
  readonly reads: number
  readonly now: number
  readonly call: unknown
}

const add = (left: ReadCounts, right: ReadCounts): ReadCounts => ({
  posts: left.posts + right.posts,
  authors: left.authors + right.authors,
  users: left.users + right.users,
})

/** At most `max` characters, ending in `…`, never splitting a surrogate pair. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max - 1
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return `${text.slice(0, end)}…`
}

/** One post as a contract event, under one feed's source name. */
export function postEvent(account: string, feed: Feed, post: Post): SourceEvent {
  const author = post.author
  const first = post.text.split("\n").find((line) => line.trim() !== "")?.trim() ?? ""
  return makeEvent({
    source: feed,
    account,
    external_id: feed === "bookmarks" ? `bookmark:${post.id}` : post.id,
    kind: feed === "bookmarks" ? "bookmark" : "message",
    occurred_at: post.created,
    thread: post.conversation === undefined ? null : `x-conversation:${post.conversation}`,
    actors:
      author === undefined
        ? []
        : [
            {
              role: "from",
              id: author.username === undefined ? `x:${author.id}` : `x:@${author.username.toLowerCase()}`,
              ...(author.name === undefined || author.name === "" ? {} : { name: author.name }),
            },
          ],
    title: first === "" ? `Post ${post.id}` : shorten(first, 120),
    text: post.text,
    url: `https://x.com/i/status/${post.id}`,
    labels: [LABELS[feed]],
  })
}

/** One feed's page walk. */
export async function walkFeed(walk: FeedWalk): Promise<FeedRead> {
  return walk.feed === "bookmarks" ? bookmarks(walk) : window(walk)
}

/** The page input every read of one feed shares. */
function pageInput(me: XUser, size: number, extra: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { id: me.id, max_results: size, ...FIELDS, ...extra }
}

/**
 * Mentions or the timeline after the state's post (or time), oldest first. The window is read newest first; a window
 * the call cannot finish is narrowed to below its oldest post so the next call continues there, and a window read to
 * its end is listed from its oldest post up to the page's limit. `u` caps a narrowed window.
 */
async function window(walk: FeedWalk): Promise<FeedRead> {
  const { provider, account, feed, me, limit, maxBytes, now, call } = walk
  const state = walk.state as WindowState
  const start = state.p === undefined && (state.t ?? 0) > now
  if (start) return { state, events: [], more: false, cost: { posts: 0, authors: 0, users: 0 } }

  let reads = walk.reads
  let cost: ReadCounts = { posts: 0, authors: 0, users: 0 }
  let gap: EventsGap | undefined
  // A cursor's post is the window's low bound: when X no longer lists a post at or before it, history may be lost.
  // The check is one read of its own: never spend the call's only feed read on it.
  if (state.p !== undefined && reads >= 2) {
    const check = await provider.page(account, feed, { id: me.id, max_results: 5, until_id: (BigInt(state.p) + 1n).toString(), "post.fields": "created_at" }, call)
    reads -= 1
    cost = add(cost, { posts: check.posts_read, authors: check.authors_read, users: 0 })
    if (check.posts.length === 0) gap = { reason: "expired", since: iso(state.w ?? state.t ?? now) }
  }

  const found = new Map<string, Post>()
  let token: string | undefined
  let complete = false
  const followed = new Set<string>()
  while (reads > 0) {
    const time = state.p === undefined ? iso(Math.max(state.t ?? 0, X_EARLIEST)) : undefined
    const input = pageInput(me, Math.min(limit, PAGE_SIZE), {
      ...(time === undefined ? { since_id: state.p } : { start_time: time }),
      ...(state.u === undefined ? {} : { until_id: state.u }),
      ...(token === undefined ? {} : { pagination_token: token }),
    })
    const page = await provider.page(account, feed, input, call)
    reads -= 1
    cost = add(cost, { posts: page.posts_read, authors: page.authors_read, users: 0 })
    for (const post of page.posts) {
      if (state.p !== undefined && BigInt(post.id) <= BigInt(state.p)) continue
      if (state.u !== undefined && BigInt(post.id) >= BigInt(state.u)) continue
      found.set(post.id, post)
    }
    if (page.next === undefined || followed.has(page.next)) {
      complete = true
      break
    }
    token = page.next
    followed.add(token)
  }
  const posts = [...found.values()].sort(byId)
  const answer = (next: WindowState, events: readonly SourceEvent[], more: boolean): FeedRead => ({
    state: next,
    events,
    more,
    cost,
    ...(gap === undefined ? {} : { gap }),
  })

  if (!complete) {
    // Out of reads before the window ended: the next call reads below the oldest post this one saw, and nothing is listed
    // yet. The `d` flag says the posts above that point were read and discarded, so a later call returns for them.
    return answer(posts.length === 0 ? state : { ...state, u: posts[0]!.id, d: 1 }, [], true)
  }
  if (posts.length === 0) {
    if (state.u === undefined) return answer(state, [], false)
    // The narrowed window is empty: resume above its cap, where the posts an earlier call discarded wait.
    const more = state.d === 1
    return answer({ ...state, p: (BigInt(state.u) - 1n).toString(), u: undefined, d: undefined }, [], more)
  }
  const events = posts.map((post) => postEvent(account, feed, post))
  const count = fitPage(events, limit, maxBytes)
  const listed = events.slice(0, count)
  const lastListed = posts[count - 1]
  if (lastListed === undefined) return answer(state, [], true)
  if (count < posts.length) {
    const cap = state.u ?? (BigInt(posts.at(-1)!.id) + 1n).toString()
    return answer({ ...state, p: lastListed.id, u: cap, w: lastListed.created }, listed, true)
  }
  if (state.u !== undefined) {
    // The narrowed window is listed: resume above its cap, where the posts an earlier call discarded wait.
    const more = state.d === 1
    return answer({ ...state, p: (BigInt(state.u) - 1n).toString(), u: undefined, d: undefined, w: lastListed.created }, listed, more)
  }
  return answer({ ...state, p: lastListed.id, w: lastListed.created }, listed, false)
}

/**
 * Bookmarks added since the ones the state knows, listed oldest first. X lists bookmarks newest first and has no
 * `since_id`, so the walk stops at the first bookmark the cursor knows; a walk the cap stops resumes from X's page
 * token, and the known bookmarks move only when the walk ends.
 */
async function bookmarks(walk: FeedWalk): Promise<FeedRead> {
  const { provider, account, me, limit, maxBytes, now, call } = walk
  const state = walk.state as BookmarkState
  let reads = walk.reads
  let cost: ReadCounts = { posts: 0, authors: 0, users: 0 }
  const known = state.k ?? []
  const answer = (next: BookmarkState, events: readonly SourceEvent[], more: boolean, gap?: EventsGap): FeedRead => ({
    state: next,
    events,
    more,
    cost,
    ...(gap === undefined ? {} : { gap }),
  })

  if (known.length === 0) {
    if (reads <= 0) return answer(state, [], true)
    const size = Math.min(KNOWN_BOOKMARKS, limit)
    if (size <= 0) return answer(state, [], true)
    const page = await provider.page(account, "bookmarks", pageInput(me, size, FIELDS), call)
    reads -= 1
    cost = add(cost, { posts: page.posts_read, authors: page.authors_read, users: 0 })
    const start = state.t ?? 0
    const events = page.posts.filter((post) => post.created >= start).map((post) => postEvent(account, "bookmarks", post))
    const k = page.posts.slice(0, KNOWN_BOOKMARKS).map((post) => post.id)
    return answer({ t: state.t, w: now, ...(k.length === 0 ? {} : { k }) }, events.slice(0, fitPage(events, limit, maxBytes)), false)
  }

  let newest = state.n
  let token = state.r
  let walked = 0
  const listed: SourceEvent[] = []
  const followed = new Set<string>(token === undefined ? [] : [token])
  while (reads > 0) {
    const room = limit - listed.length
    if (room <= 0) return answer({ ...state, r: token, n: newest, w: state.w }, listed, true)
    const size = Math.min(BOOKMARK_PAGE, room)
    const page = await provider.page(account, "bookmarks", pageInput(me, size, { ...FIELDS, ...(token === undefined ? {} : { pagination_token: token }) }), call)
    reads -= 1
    cost = add(cost, { posts: page.posts_read, authors: page.authors_read, users: 0 })
    newest = [...(newest ?? []), ...page.posts.map((post) => post.id)].slice(0, KNOWN_BOOKMARKS)
    const stop = page.posts.findIndex((post) => known.includes(post.id))
    const fresh = stop === -1 ? page.posts : page.posts.slice(0, stop)
    const events = fresh.map((post) => postEvent(account, "bookmarks", post))
    const fit = fitPage(events, limit - listed.length, maxBytes)
    if (fit < events.length) return answer({ ...state, r: token, n: newest, w: state.w }, listed, true)
    listed.push(...events)
    if (stop !== -1 || page.next === undefined || followed.has(page.next)) {
      const k = [...(newest ?? []), ...known].filter((id, index, all) => all.indexOf(id) === index).slice(0, KNOWN_BOOKMARKS)
      const lost = stop === -1 && walked + page.posts.length >= BOOKMARK_REACH - BOOKMARK_MARGIN
      return answer({ k, t: state.t, w: now }, listed, false, lost ? { reason: "expired", since: iso(state.w ?? state.t ?? now) } : undefined)
    }
    token = page.next
    followed.add(token)
    walked += page.posts.length
  }
  return answer({ ...state, r: token, n: newest, w: state.w }, listed, true)
}

// ── Cursor state ────────────────────────────────────────────────────────

const optional = <T>(value: unknown, check: (value: unknown) => T | undefined): T | undefined | false => (value === undefined ? undefined : (check(value) ?? false))
const id = (value: unknown) => (typeof value === "string" && POST_ID.test(value) ? value : undefined)
const time = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) ? value : undefined)
const checked = (value: unknown) => (value === 1 ? (1 as const) : undefined)
const tokenValue = (value: unknown) => (typeof value === "string" && /^[\w-]{1,200}$/.test(value) ? value : undefined)
const ids = (value: unknown): string[] | undefined => (Array.isArray(value) && value.length <= KNOWN_BOOKMARKS && value.every((entry) => typeof entry === "string" && POST_ID.test(entry)) ? value : undefined)
const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/** A window state from a cursor, or undefined when the cursor is not one this feed issued. */
export function windowState(value: unknown): WindowState | undefined {
  const data = record(value)
  const [p, t, u, w, d] = [optional(data["p"], id), optional(data["t"], time), optional(data["u"], id), optional(data["w"], time), optional(data["d"], checked)]
  if (p === false || t === false || u === false || w === false || d === false || (p === undefined && t === undefined)) return undefined
  return {
    ...(p === undefined ? {} : { p }),
    ...(t === undefined ? {} : { t }),
    ...(u === undefined ? {} : { u }),
    ...(w === undefined ? {} : { w }),
    ...(d === undefined ? {} : { d }),
  }
}

/** A bookmark state from a cursor, or undefined when the cursor is not one this feed issued. */
export function bookmarkState(value: unknown): BookmarkState | undefined {
  const data = record(value)
  const [k, t, r, n, w] = [optional(data["k"], ids), optional(data["t"], time), optional(data["r"], tokenValue), optional(data["n"], ids), optional(data["w"], time)]
  if (k === false || t === false || r === false || n === false || w === false || (k === undefined && t === undefined)) return undefined
  return {
    ...(k === undefined ? {} : { k }),
    ...(t === undefined ? {} : { t }),
    ...(r === undefined ? {} : { r }),
    ...(n === undefined ? {} : { n }),
    ...(w === undefined ? {} : { w }),
  }
}

/** The state a cursor of `feed` carries, or undefined when it is not one this feed issued. */
export const feedState = (feed: Feed, value: unknown): FeedState | undefined => (feed === "bookmarks" ? bookmarkState(value) : windowState(value))
