// A synthetic X, faithful to the v2 reads this plugin makes: `get_users_me` and the three feed reads, with the same
// `since_id`, `until_id`, `start_time`, `pagination_token` and `max_results` semantics, the same `data`/`includes`/`meta`
// answer shape (through the real parser), and the same per-post and per-author bill. Every handle, post and id is
// invented; no request leaves the test.
import type { Feed, Provider, ReadCounts } from "../../src/provider/index.js"
import type { ServerState } from "../../src/provider/errors.js"
import type { PostsPage, XResult, XUser } from "../../src/provider/parse.js"
import { postsPage } from "../../src/provider/parse.js"

interface FakePost {
  readonly id: string
  readonly text: string
  readonly created: string
  readonly conversation: string
  readonly author: { readonly id: string; readonly username: string; readonly name?: string }
}

interface Account {
  readonly user: XUser
  readonly feeds: Readonly<Record<Feed, readonly FakePost[]>>
}

const author = (id: string, username: string) => ({ id, username })

const WORK = author("2001", "anawork")
const KAI = author("2002", "kaim")
const PERSONAL = author("3001", "anapersonal")
const ROWAN = author("3002", "rowanv")

const post = (id: string, created: string, text: string, conversation: string, by: typeof WORK): FakePost => ({
  id,
  text,
  created,
  conversation,
  author: by,
})

/** Two invented accounts; `work` has two mentions, one bookmark and two timeline posts, `personal` one of each. */
export const ACCOUNTS: Readonly<Record<string, Account>> = {
  work: {
    user: { id: "1001", username: "AnaWork" },
    feeds: {
      mentions: [
        post("9001", "2026-11-18T10:15:00.000Z", "The queue migration is on for Thursday. The runbook is in the shared space.", "7001", KAI),
        post("9002", "2026-11-18T10:31:00.000Z", "Rehearsal passed. I will watch the lag after the switch.", "7001", WORK),
      ],
      bookmarks: [post("9101", "2026-11-19T08:40:00.000Z", "A bookmarked note on billing units.", "7101", KAI)],
      timeline: [
        post("9201", "2026-11-20T09:05:00.000Z", "A timeline post about a release.", "7201", KAI),
        post("9202", "2026-11-20T09:20:00.000Z", "A second timeline post, with a link.", "7202", WORK),
      ],
    },
  },
  personal: {
    user: { id: "1002", username: "AnaPersonal" },
    feeds: {
      mentions: [post("9301", "2026-11-17T19:05:00.000Z", "Are we still walking on Saturday?", "7301", ROWAN)],
      bookmarks: [post("9401", "2026-11-17T20:10:00.000Z", "A personal bookmark.", "7401", PERSONAL)],
      timeline: [post("9501", "2026-11-17T21:15:00.000Z", "A personal timeline post.", "7501", ROWAN)],
    },
  },
  // Two posts share a timestamp, on purpose: a page boundary between them must not lose the second.
  same: {
    user: { id: "1003", username: "AnaSame" },
    feeds: {
      mentions: [post("9701", "2026-11-21T08:00:00.000Z", "A mention for the same-time account.", "7701", KAI)],
      bookmarks: [post("9702", "2026-11-21T08:10:00.000Z", "A bookmark for the same-time account.", "7702", KAI)],
      timeline: [
        post("9601", "2026-11-21T09:00:00.000Z", "The earlier post of a shared second.", "7601", WORK),
        post("9602", "2026-11-21T09:00:00.000Z", "The later post of the same shared second.", "7602", KAI),
      ],
    },
  },
}

/** One call the fake answered. */
export interface FakeCall {
  readonly account: string
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
}

/** One synthetic X with its call log. */
export interface FakeX extends Provider {
  readonly calls: FakeCall[]
  /** Replace the MCP server states status reads. */
  setServers(states: readonly ServerState[]): void
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

/** X's own answer for one feed read, as the vendor's MCP server would return it: a text part holding JSON. */
function answer(account: string, feed: Feed, input: Readonly<Record<string, unknown>>): { result: XResult; page: PostsPage } {
  const held = ACCOUNTS[account]
  if (held === undefined) throw new Error(`the fake X has no account ${account}`)
  let posts = [...held.feeds[feed]].sort((left, right) => (BigInt(left.id) < BigInt(right.id) ? 1 : BigInt(left.id) > BigInt(right.id) ? -1 : 0))
  const since = text(input["since_id"])
  const until = text(input["until_id"])
  const start = text(input["start_time"])
  const end = text(input["end_time"])
  if (since !== undefined) posts = posts.filter((entry) => BigInt(entry.id) > BigInt(since))
  if (until !== undefined) posts = posts.filter((entry) => BigInt(entry.id) < BigInt(until))
  if (start !== undefined) posts = posts.filter((entry) => Date.parse(entry.created) >= Date.parse(start))
  if (end !== undefined) posts = posts.filter((entry) => Date.parse(entry.created) < Date.parse(end))
  const token = text(input["pagination_token"])
  const offset = token === undefined ? 0 : Number(token.replace(/^offset:/, "")) || 0
  const size = typeof input["max_results"] === "number" ? input["max_results"] : 10
  const page = posts.slice(offset, offset + size)
  const next = offset + page.length < posts.length ? `offset:${offset + page.length}` : undefined
  const authorIds = input["expansions"] === "author_id" ? [...new Set(page.map((entry) => entry.author.id))] : []
  const users = authorIds.map((id) => {
    const found = page.find((entry) => entry.author.id === id)?.author
    return { id, username: found?.username, name: found?.name }
  })
  const payload = {
    data: page.map((entry) => ({
      id: entry.id,
      text: entry.text,
      created_at: entry.created,
      conversation_id: entry.conversation,
      author_id: entry.author.id,
    })),
    ...(authorIds.length === 0 ? {} : { includes: { users } }),
    meta: {
      result_count: page.length,
      ...(next === undefined ? {} : { next_token: next }),
    },
  }
  const result: XResult = { content: [{ type: "text", text: JSON.stringify(payload) }] }
  return { result, page: postsPage(feed === "bookmarks" ? "get_users_bookmarks" : `get_users_${feed}`, result) }
}

/** A fresh fake with both accounts connected. */
export function createFakeX(): FakeX {
  const calls: FakeCall[] = []
  let servers: readonly ServerState[] = [
    { name: "x", status: "connected" },
    { name: "x-work", status: "connected" },
    { name: "x-personal", status: "connected" },
  ]

  return {
    calls,
    setServers(states) {
      servers = states
    },
    async me(account: string): Promise<{ user: XUser; cost: ReadCounts }> {
      const held = ACCOUNTS[account]
      if (held === undefined) throw new Error(`the fake X has no account ${account}`)
      calls.push({ account, tool: "get_users_me", input: {} })
      return { user: held.user, cost: { posts: 0, authors: 0, users: 1 } }
    },
    async page(account: string, feed: Feed, input: Readonly<Record<string, unknown>>): Promise<PostsPage> {
      calls.push({ account, tool: `get_users_${feed}`, input })
      return answer(account, feed, input).page
    },
    async servers(): Promise<readonly ServerState[]> {
      return servers
    },
  }
}
