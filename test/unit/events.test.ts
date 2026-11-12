// x_events_list, Memory's source of X events, against a synthetic X: the shared contract's conformance check through
// the tool and through the tools RPC method, the call cap, the window narrowing that keeps oldest first, bookmarks
// walked to the last known one, and the refusals. Every handle, post and id below is invented.
import { describe, expect, test } from "bun:test"
import { EVENTS_ACTION, eventsMethod, eventsTool, meOf, postEvent, postsPage, type EventsToolOptions, type Feed } from "../../src/events.js"
import { assertEventsListConformance, encodeCursor, resultProblems, type EventsListInput, type EventsListResult } from "../../src/host/events-list.js"
import type { ToolCall } from "../../src/host/tools-rpc.js"
import type { Status } from "../../src/status.js"

const NOW = Date.parse("2026-11-08T12:00:00Z")
const SINCE = "2026-11-01T00:00:00Z"
const ME = "1000000000000000001"
const OWNER = { id: "x:@samrivera", label: "Sam Rivera (@SamRivera)" }
const EPOCH = 1288834974657n
/** A snowflake id for a time, as X's ids grow with time; `n` keeps posts of one second apart. */
const idAt = (iso: string, n = 0) => (((BigInt(Date.parse(iso)) - EPOCH) << 22n) + BigInt(n)).toString()

interface FakePost {
  id: string
  text: string
  created_at: string
  author_id: string
  conversation_id: string
}
const USERS = [
  { id: "2000000000000000002", username: "AmaMensah", name: "Ama Mensah" },
  { id: "2000000000000000003", username: "KofiBoateng", name: "Kofi Boateng" },
]
const post = (iso: string, author: number, text: string, n = 0): FakePost => {
  const id = idAt(iso, n)
  return { id, text, created_at: iso.replace("Z", ".000Z"), author_id: USERS[author]!.id, conversation_id: id }
}

/** Mentions all come before the timeline's posts, so a paged walk and one whole call list them in the same order. */
const fixture = () => ({
  mentions: [
    post("2026-10-30T09:00:00Z", 0, "@SamRivera before since"),
    post("2026-11-01T09:00:00Z", 0, "@SamRivera can you check the draft?"),
    post("2026-11-01T10:00:00Z", 1, "@SamRivera thanks for the review"),
    post("2026-11-02T08:00:00Z", 0, "@SamRivera one more thing\nsecond line"),
  ],
  timeline: [post("2026-10-31T09:00:00Z", 1, "Before since"), post("2026-11-03T09:00:00Z", 1, "Launch day"), post("2026-11-04T09:00:00Z", 0, "Notes from the launch"), post("2026-11-05T09:00:00Z", 1, "A week later")],
  // Newest bookmarked first, as X lists them.
  bookmarks: [post("2026-10-20T09:00:00Z", 1, "An old post, bookmarked last"), post("2026-11-02T12:00:00Z", 0, "Worth keeping")],
})
const FEEDS: Feed[] = ["mentions", "timeline", "bookmarks"]
const LISTED = [...fixture().mentions.slice(1), ...fixture().timeline.slice(1)].map((item) => item.id)

const TOOL: Record<string, keyof ReturnType<typeof fixture>> = { x_get_users_mentions: "mentions", x_get_users_timeline: "timeline", x_get_users_bookmarks: "bookmarks" }

/**
 * The host's executors for X's reads, answering from `data` as X does: v2 JSON with `data`, `includes.users` and
 * `meta.next_token`; mentions and the timeline newest first, after `since_id` or from `start_time`, before `until_id`;
 * bookmarks in their own order. Pages hold at most `pageSize` posts.
 */
function x(data = fixture(), pageSize = 2) {
  const calls: { tool: string; input: Record<string, unknown> }[] = []
  const answer = (value: unknown) => ({ output: value, content: [{ type: "text", text: JSON.stringify(value) }] })
  const execute = (tool: string, input: Record<string, unknown>) => {
    if (tool === "x_get_users_me") return answer({ data: { id: ME, username: "SamRivera", name: "Sam Rivera" } })
    const feed = TOOL[tool]!
    if (input["id"] !== ME) return answer({ errors: [{ title: "Forbidden", detail: "Not this user" }] })
    let posts = [...data[feed]]
    if (feed !== "bookmarks") {
      const since = input["since_id"] === undefined ? undefined : BigInt(String(input["since_id"]))
      const start = input["start_time"] === undefined ? undefined : Date.parse(String(input["start_time"]))
      const until = input["until_id"] === undefined ? undefined : BigInt(String(input["until_id"]))
      posts = posts.filter((item) => (since === undefined || BigInt(item.id) > since) && (start === undefined || Date.parse(item.created_at) >= start) && (until === undefined || BigInt(item.id) < until))
      posts.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
    }
    const from = Number(input["pagination_token"] ?? 0)
    const size = Math.min(pageSize, Number(input["max_results"] ?? 100))
    const page = posts.slice(from, from + size)
    const next = from + size < posts.length ? String(from + size) : undefined
    const users = String(input["expansions"] ?? "").includes("author_id") ? USERS.filter((user) => page.some((item) => item.author_id === user.id)) : []
    return answer({ ...(page.length === 0 ? {} : { data: page, ...(users.length === 0 ? {} : { includes: { users } }) }), meta: { result_count: page.length, ...(next === undefined ? {} : { next_token: next }) } })
  }
  const list = async () =>
    ["x_get_users_me", ...Object.keys(TOOL)].map((id) => ({
      id,
      execute: async (input: Record<string, unknown>) => {
        calls.push({ tool: id, input })
        return execute(id, input)
      },
    }))
  return { tool: { list: list as never }, calls, data }
}

const connected = { state: "connected", nextStep: "Nothing to do." } as unknown as Status
const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal } as never

function options(host = x(), more: Partial<EventsToolOptions> = {}, asserts: unknown[] = []): EventsToolOptions {
  return { tool: host.tool, permission: { assert: async (input) => void asserts.push(input) }, feeds: FEEDS, maxCalls: 50, owned: () => true, status: async () => connected, now: () => NOW, ...more }
}
const run = (host = x(), more: Partial<EventsToolOptions> = {}) => {
  const tool = eventsTool(options(host, more))
  return async (input: EventsListInput) => (await tool.execute(input, context)).output
}

/** Calls with each result's cursor until `more` is false, and the ids listed. */
async function walk(list: (input: EventsListInput) => Promise<EventsListResult>, first: EventsListInput, rest: EventsListInput = {}) {
  const ids: string[] = []
  let page = await list(first)
  for (let calls = 0; calls < 40; calls++) {
    ids.push(...page.events.map((event) => event.external_id))
    if (!page.more) return { ids, cursor: page.cursor }
    page = await list({ ...rest, cursor: page.cursor })
  }
  throw new Error("the walk did not end")
}

describe("x_events_list", () => {
  test("keeps the events_list contract through the tool", async () => {
    await assertEventsListConformance(run(), { source: "x", account: "samrivera", owner: OWNER, since: SINCE, expected: LISTED })
    await assertEventsListConformance(run(x(fixture(), 1)), { source: "x", owner: OWNER, since: SINCE, expected: LISTED, pageSize: 3 })
  })

  test("keeps the events_list contract through the tools RPC method", async () => {
    const method = eventsMethod(options())
    const call: ToolCall = { sessionID: "ses_1", agent: "build", messageID: "msg_script", id: "script:1", signal: new AbortController().signal, progress: async () => {} }
    await assertEventsListConformance(async (input) => method.run(input, call), { source: "x", account: "samrivera", owner: OWNER, since: SINCE, expected: LISTED, sourceInput: true })
  })

  test("asserts x_events_list as the calling tool, asks X only for what an event needs, and says what it cost", async () => {
    const host = x()
    const asserts: unknown[] = []
    const tool = eventsTool(options(host, {}, asserts))
    const result = await tool.execute({ since: SINCE }, context)
    expect(asserts).toEqual([{ sessionID: "ses_1", agent: "build", action: EVENTS_ACTION, resources: ["*"], source: { type: "tool", messageID: "msg_1", id: "call_1" } }])
    expect(EVENTS_ACTION).toBe("x_events_list")
    expect(host.calls[0]).toEqual({ tool: "x_get_users_me", input: { "user.fields": "username,name" } })
    expect(host.calls[1]).toEqual({
      tool: "x_get_users_mentions",
      input: { id: ME, max_results: 100, expansions: "author_id", "post.fields": "created_at,author_id,conversation_id,text,note_tweet", "user.fields": "username,name", start_time: "2026-11-01T00:00:00.000Z" },
    })
    expect(resultProblems(result.output)).toEqual([])
    expect(result.content).toStartWith(`6 X events from mentions, timeline, bookmarks, oldest first, in ${host.calls.length} billed reads of at most 50. That is everything up to now`)
    // The six listed posts and the two bookmarks the first listing notes, with the authors X included.
    // The test does not sign in as the owner of the developer app, so the line is the conservative estimate.
    expect(result.content).toContain("Cost: at most 8 owned posts ($0.04) + 6 authors ($0.06) = $0.10.")
    expect(tool.options).toEqual({ namespace: "x" })
  })

  test("makes one event per post: the author's handle, the conversation, the link and the feed", async () => {
    const [first] = (await run()({ since: SINCE })).events
    const mention = fixture().mentions[1]!
    expect(first).toMatchObject({
      source: "x",
      account: "samrivera",
      external_id: mention.id,
      kind: "message",
      occurred_at: "2026-11-01T09:00:00.000Z",
      thread: `x-conversation:${mention.id}`,
      actors: [{ role: "from", id: "x:@amamensah", name: "Ama Mensah" }],
      title: "@SamRivera can you check the draft?",
      url: `https://x.com/i/status/${mention.id}`,
      labels: ["mention"],
    })
    const bookmark = postEvent("samrivera", "bookmarks", { id: "42", text: "", created: Date.parse(SINCE), author: { id: "7" } })
    expect([bookmark.external_id, bookmark.kind, bookmark.title, bookmark.actors, bookmark.thread, bookmark.labels]).toEqual(["bookmark:42", "bookmark", "Post 42", [{ role: "from", id: "x:7" }], null, ["bookmark"]])
  })

  test("reads X's v2 answers and refuses one it cannot read, or X's own error", () => {
    const answer = (value: unknown) => ({ output: value, content: [] }) as never
    expect(postsPage("t", answer({ data: [{ id: "5", text: "hi", created_at: SINCE, note_tweet: { text: "the long text" } }, { id: "x" }], meta: { next_token: "abc" } }))).toEqual({
      posts: [{ id: "5", text: "the long text", created: Date.parse(SINCE) }],
      next: "abc",
    })
    expect(postsPage("t", answer({ meta: { result_count: 0 } }))).toEqual({ posts: [] })
    expect(postsPage("t", { content: [{ type: "text", text: JSON.stringify({ data: [], meta: {} }) }] } as never)).toEqual({ posts: [] })
    expect(() => postsPage("get_users_mentions", answer({ errors: [{ title: "Forbidden", detail: "Not allowed\nmore" }] }))).toThrow(/^UPSTREAM_ERROR: X's get_users_mentions failed: Not allowed\./)
    expect(() => postsPage("get_users_mentions", { content: [{ type: "text", text: "rate limited" }] } as never)).toThrow(/^UPSTREAM_UNREADABLE: /)
    expect(() => meOf(answer({ data: { id: ME } }))).toThrow(/^UPSTREAM_UNREADABLE: X's get_users_me/)
  })

  test("never makes more billed reads than the cap, and still lists every post once, oldest first", async () => {
    const many = { ...fixture(), mentions: Array.from({ length: 13 }, (_, n) => post(`2026-11-0${2 + (n % 6)}T09:00:00Z`, n % 2, `Mention ${n}`, n)) }
    const host = x(many, 2)
    const list = run(host, { feeds: ["mentions"], maxCalls: 3 })
    const before = () => host.calls.length
    const counts: number[] = []
    const ids: string[] = []
    let page = await list({ since: SINCE })
    for (let calls = 0; calls < 40; calls++) {
      ids.push(...page.events.map((event) => event.external_id))
      if (!page.more) break
      const at = before()
      page = await list({ cursor: page.cursor })
      counts.push(host.calls.length - at)
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(3)
    expect(ids).toEqual([...many.mentions].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((item) => item.id))
    // A window too large for the cap was narrowed with until_id, never skipped.
    expect(host.calls.some((call) => call.input["until_id"] !== undefined)).toBe(true)
  })

  test("a page token X keeps handing back ends each feed's walk, even with a large call cap", async () => {
    const host = x()
    const loop = (value: unknown) => ({ output: value, content: [{ type: "text", text: JSON.stringify(value) }] })
    const tools = await (host.tool.list as unknown as () => Promise<{ id: string; execute: (input: Record<string, unknown>) => Promise<unknown> }[]>)()
    const looping = tools.map((entry) =>
      entry.id === "x_get_users_me"
        ? entry
        : {
            id: entry.id,
            execute: async (input: Record<string, unknown>) => {
              host.calls.push({ tool: entry.id, input })
              // The first bookmarks listing (ids only, no expansions) notes one bookmark; after that every feed answers an
              // empty page and the same token for ever.
              if (entry.id === "x_get_users_bookmarks" && input["expansions"] === undefined) return loop({ data: [post("2026-11-02T12:00:00Z", 0, "Known")], meta: { result_count: 1 } })
              return loop({ meta: { result_count: 0, next_token: "same-token" } })
            },
          },
    )
    const tool = eventsTool(options({ ...host, tool: { list: (async () => looping) as never } }, { maxCalls: 10_000 }))
    const first = await tool.execute({ since: SINCE }, context)
    // Mentions and the timeline each stop on the repeated token: one read, then one that hands it back.
    expect(host.calls.filter((call) => call.tool === "x_get_users_mentions")).toHaveLength(2)
    expect(host.calls.filter((call) => call.tool === "x_get_users_timeline")).toHaveLength(2)
    const before = host.calls.filter((call) => call.tool === "x_get_users_bookmarks").length
    await tool.execute({ cursor: first.output.cursor }, context)
    // The bookmarks walk, now with a known bookmark, also stops when the token comes back.
    expect(host.calls.filter((call) => call.tool === "x_get_users_bookmarks").length - before).toBe(2)
    expect(host.calls.length).toBeLessThan(20)
  })

  test("lists a post that is both a mention and in the timeline once", async () => {
    const both = fixture()
    both.timeline.push(both.mentions[2]!)
    const result = await run(x(both))({ since: SINCE })
    expect(result.events.filter((event) => event.external_id === both.mentions[2]!.id)).toHaveLength(1)
  })

  test("bookmarks: the first listing notes the newest, and later ones list each bookmark added since, page by page", async () => {
    const host = x(fixture(), 2)
    const list = run(host, { feeds: ["bookmarks"] })
    const first = await list({ since: SINCE })
    expect([first.events, first.more]).toEqual([[], false])
    const added = [post("2026-11-07T09:00:00Z", 0, "New bookmark 1"), post("2026-11-06T09:00:00Z", 1, "New bookmark 2"), post("2026-10-01T09:00:00Z", 0, "An old post, bookmarked now")]
    host.data.bookmarks.unshift(...added)
    // A limit of 1 makes pages of one: the walk resumes from X's token and stops at the first known bookmark.
    const { ids, cursor } = await walk(list, { cursor: first.cursor, limit: 1 }, { limit: 1 })
    expect(ids.sort()).toEqual(added.map((item) => `bookmark:${item.id}`).sort())
    expect((await list({ cursor })).events).toEqual([])
    // Removing the newest known bookmark does not restart the walk: the others are known too.
    host.data.bookmarks.shift()
    expect((await list({ cursor })).events).toEqual([])
  })

  test("refuses an input, a source, an account or a cursor that is not this account's", async () => {
    const list = run()
    await expect(list({ limit: 0 })).rejects.toThrow(/^INPUT_INVALID: /)
    await expect(list({ source: "slack" })).rejects.toThrow(/^SOURCE_UNKNOWN: /)
    await expect(list({ account: "someoneelse" })).rejects.toThrow(/^ACCOUNT_UNKNOWN: .* Next step: Leave "account" out, or pass "samrivera"/)
    expect((await list({ account: "@SamRivera", limit: 1 })).account).toBe("samrivera")
    await expect(list({ cursor: encodeCursor("x", { o: "0000000000000000", f: {} }) })).rejects.toThrow(/^CURSOR_INVALID: /)
    const good = (await list({ since: SINCE, limit: 1 })).cursor
    const state = JSON.parse(Buffer.from(good, "base64url").toString("utf8")) as Record<string, unknown>
    await expect(list({ cursor: encodeCursor("x", { o: state["o"], f: { m: { s: "not an id" } } }) })).rejects.toThrow(/^CURSOR_INVALID: /)
  })

  test("passes a refused read through untouched, and names status's code when it cannot call X", async () => {
    const refusal = Object.assign(new Error("Permission denied: x_get_users_mentions"), { _tag: "Tool.Error", error: { _tag: "Permission.DeniedError" } })
    const failing = {
      list: async () => [
        { id: "x_get_users_me", execute: async () => ({ output: { data: { id: ME, username: "SamRivera" } } }) },
        {
          id: "x_get_users_mentions",
          execute: async () => {
            throw refusal
          },
        },
      ],
    }
    await expect(eventsTool({ ...options(), tool: failing as never }).execute({}, context)).rejects.toBe(refusal)
    const upstream = { list: async () => [{ id: "x_get_users_me", execute: async () => Promise.reject(Object.assign(new Error("x"), { _tag: "Tool.Error", message: "429 Too Many Requests" })) }] }
    await expect(eventsTool({ ...options(), tool: upstream as never }).execute({}, context)).rejects.toThrow(/^UPSTREAM_ERROR: X's get_users_me failed: 429 Too Many Requests\./)
    const signIn = { state: "sign_in_required", code: "AUTH_REQUIRED", message: "Sign in to X.", nextStep: "Run /connect and choose X." } as unknown as Status
    await expect(eventsTool({ ...options(), tool: { list: async () => [] } as never, status: async () => signIn }).execute({}, context)).rejects.toThrow(
      "AUTH_REQUIRED: Sign in to X; events_list cannot call get_users_me. Next step: Run /connect and choose X.",
    )
    expect(await eventsMethod({ ...options(), status: async () => signIn }).available!()).toBe("AUTH_REQUIRED")
    expect(await eventsMethod(options()).available!()).toBeUndefined()
  })
})
