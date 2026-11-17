// x_events_list and probe, X's sources, against a synthetic X: the shared contract's conformance check through the
// tool and through the tools RPC method, the call cap, the window narrowing that keeps oldest first, bookmarks walked
// to the last known one, the feed sources' own account, cursor, refusal and cost, the probe, and the refusals. Every
// handle, post and id below is invented. test/conformance runs the contract's full kit over the declared sources.
import { describe, expect, test } from "bun:test"
import { decodeBoundCursor, encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { createHash } from "node:crypto"
import { EVENTS_ACTION, PACKAGE, PROBE_ACTION, eventsMethod, eventsTool, meOf, postEvent, postsPage, probeMethod, type EventsToolOptions, type Feed } from "../../src/events.js"
import { assertEventsListConformance, encodeCursor, resultProblems, type EventsListInput, type EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import type { Status } from "../../src/status.js"

const NOW = Date.parse("2026-11-08T12:00:00Z")
const SINCE = "2026-11-01T00:00:00Z"
const SINCE_ISO = new Date(SINCE).toISOString()
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
 * `meta.next_token`; mentions and the timeline newest first, after `since_id` or from `start_time`, before `until_id` or
 * `end_time`;
 * bookmarks in their own order. Pages hold at most `pageSize` posts.
 */
function x(data = fixture(), pageSize = 2) {
  const calls: { tool: string; input: Record<string, unknown> }[] = []
  const answer = (value: unknown) => ({ output: value, content: [{ type: "text", text: JSON.stringify(value) }] })
  const execute = (tool: string, input: Record<string, unknown>) => {
    if (tool === "x_get_users_me") return answer({ data: { id: ME, username: "SamRivera", name: "Sam Rivera" } })
    if (tool === "x_get_users_by_username") {
      return String(input["username"]) === "samrivera" ? answer({ data: { id: ME, username: "SamRivera", name: "Sam Rivera" } }) : answer({ errors: [{ title: "Not Found Error", detail: "Could not find user." }] })
    }
    const feed = TOOL[tool]!
    if (input["id"] !== ME) return answer({ errors: [{ title: "Forbidden", detail: "Not this user" }] })
    let posts = [...data[feed]]
    if (feed !== "bookmarks") {
      const since = input["since_id"] === undefined ? undefined : BigInt(String(input["since_id"]))
      const start = input["start_time"] === undefined ? undefined : Date.parse(String(input["start_time"]))
      const until = input["until_id"] === undefined ? undefined : BigInt(String(input["until_id"]))
      const end = input["end_time"] === undefined ? undefined : Date.parse(String(input["end_time"]))
      posts = posts.filter(
        (item) =>
          (since === undefined || BigInt(item.id) > since) &&
          (start === undefined || Date.parse(item.created_at) >= start) &&
          (end === undefined || Date.parse(item.created_at) < end) &&
          (until === undefined || BigInt(item.id) < until),
      )
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
    ["x_get_users_me", "x_get_users_by_username", ...Object.keys(TOOL)].map((id) => ({
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

  test("source x still reads a cursor an earlier version issued, and lists from it what the current cursor lists", async () => {
    const list = run()
    const first = await list({ since: SINCE, limit: 2 })
    const state = JSON.parse(Buffer.from(first.cursor, "base64url").toString("utf8")) as Record<string, unknown>
    expect([state["v"], state["s"], typeof state["b"]]).toEqual([2, "x", "string"])
    const old = encodeCursor("x", { o: createHash("sha256").update(`samrivera\u0000${ME}`).digest("hex").slice(0, 16), f: state["f"] })
    expect((await list({ cursor: old })).events.map((event) => event.external_id)).toEqual((await list({ cursor: first.cursor })).events.map((event) => event.external_id))
  })
})

describe("x_events_list's feed sources", () => {
  const ACCOUNT = "samrivera"

  test("a first listing looks the named account up by its handle, never asks who is signed in, and says what X returned", async () => {
    const host = x(fixture(), 10)
    const asserts: unknown[] = []
    const result = (await eventsTool(options(host, {}, asserts)).execute({ source: "mentions", account: "@SamRivera", since: SINCE }, context)).output
    // The lookup, then one small read that checks X still lists a mention from before SINCE (it does: no gap), then the
    // mentions since SINCE.
    expect(host.calls.map((call) => call.tool)).toEqual(["x_get_users_by_username", "x_get_users_mentions", "x_get_users_mentions"])
    expect(host.calls[0]!.input).toEqual({ username: ACCOUNT, "user.fields": "username,name" })
    expect(host.calls[1]!.input).toMatchObject({ max_results: 5, end_time: SINCE_ISO, "post.fields": "created_at" })
    expect(result.gap).toBeUndefined()
    expect(asserts).toEqual([{ sessionID: "ses_1", agent: "build", action: EVENTS_ACTION, resources: ["*"], source: { type: "tool", messageID: "msg_1", id: "call_1" } }])
    expect(result).toMatchObject({ source: "mentions", account: ACCOUNT, owner: OWNER, plugin: PACKAGE, asOf: new Date(NOW).toISOString(), more: false, trust: "untrusted" })
    expect(result.events.map((event) => [event.source, event.external_id])).toEqual(fixture().mentions.slice(1).map((item) => ["mentions", item.id]))
    // Three mentions by two authors, the one mention from before SINCE that shows X still reaches back (no author: that
    // read asks for none), and the one user the lookup returned.
    expect(result.cost).toEqual({ units: [{ per: "post", count: 4 }, { per: "author", count: 2 }, { per: "user", count: 1 }] })
    expect(resultProblems(result)).toEqual([])
  })

  test("a later listing reads from its cursor and the account it names, and makes no lookup", async () => {
    const host = x()
    const list = run(host)
    const first = await list({ source: "timeline", account: ACCOUNT, since: SINCE })
    host.data.timeline.push(post("2026-11-06T09:00:00Z", 0, "Later that week"))
    const before = host.calls.length
    const next = await list({ source: "timeline", account: ACCOUNT, cursor: first.cursor })
    // One small read checks that X still lists a post from at or before the newest one listed, then the timeline since.
    expect(host.calls.slice(before).map((call) => call.tool)).toEqual(["x_get_users_timeline", "x_get_users_timeline"])
    // By id: any post up to the newest one listed.
    expect(host.calls[before]!.input).toMatchObject({ max_results: 5, until_id: (BigInt(fixture().timeline.at(-1)!.id) + 1n).toString() })
    expect(host.calls[before]!.input["end_time"]).toBeUndefined()
    expect(next.events.map((event) => event.title)).toEqual(["Later that week"])
    expect(next.owner).toEqual(OWNER)
    expect(next.gap).toBeUndefined()
    // The posts the check got back (a page of this fake holds two; no authors: it asks for none), and the new one with
    // its author.
    expect(next.cost).toEqual({ units: [{ per: "post", count: 3 }, { per: "author", count: 1 }] })
    expect((await list({ source: "timeline", account: ACCOUNT, cursor: next.cursor })).events).toEqual([])
  })

  test("refuses a listing without an account, another source's cursor, and a feed that is off", async () => {
    const list = run(x(), { feeds: ["mentions", "bookmarks"] })
    await expect(list({ source: "mentions", since: SINCE })).rejects.toThrow(/^INPUT_INVALID: A listing of X's mentions names the account it reads/)
    const cursor = (await list({ source: "mentions", account: ACCOUNT, since: SINCE })).cursor
    await expect(list({ source: "mentions", cursor })).rejects.toThrow(/^INPUT_INVALID: A listing of X's mentions names the account it reads/)
    await expect(list({ source: "bookmarks", account: ACCOUNT, cursor })).rejects.toThrow(/^CURSOR_INVALID: /)
    await expect(list({ cursor })).rejects.toThrow(/^CURSOR_INVALID: /)
    await expect(list({ source: "timeline", account: ACCOUNT })).rejects.toThrow(/^SOURCE_DISABLED: X's timeline are turned off: the events.feeds option does not name "timeline"\. Next step: Add "timeline" to events.feeds/)
    await expect(list({ source: "likes", account: ACCOUNT })).rejects.toThrow(/^SOURCE_UNKNOWN: /)
    await expect(list({ source: "mentions", account: "nobody" })).rejects.toThrow(/^UPSTREAM_ERROR: X's get_users_by_username failed: Could not find user\./)
  })

  test("refuses a cursor passed for another account with ACCOUNT_MISMATCH, and reads no post for it", async () => {
    const host = x()
    const list = run(host)
    const cursor = (await list({ source: "mentions", account: ACCOUNT, since: SINCE })).cursor
    const before = host.calls.length
    await expect(list({ source: "mentions", account: "@SomeoneElse", cursor })).rejects.toThrow(
      /^ACCOUNT_MISMATCH: The cursor is for another X account than "someoneelse"\. Next step: Pass the cursor with the account it was issued for/,
    )
    // A cursor forged for another handle, under this account's binding, names that handle: it is refused the same way.
    const state = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>
    const forged = Buffer.from(JSON.stringify({ ...state, a: "someoneelse" }), "utf8").toString("base64url")
    await expect(list({ source: "mentions", account: ACCOUNT, cursor: forged })).rejects.toThrow(/^ACCOUNT_MISMATCH: /)
    // Forged the other way, naming the asked handle under another account's binding, it is not this account's cursor.
    const other = Buffer.from(JSON.stringify({ ...state, b: "0000000000000000" }), "utf8").toString("base64url")
    await expect(list({ source: "mentions", account: ACCOUNT, cursor: other })).rejects.toThrow(/^CURSOR_INVALID: /)
    expect(host.calls.length).toBe(before)
  })

  test("a feed walked page by page in narrowed windows lists every post once, oldest first, and answers no gap", async () => {
    const many = { ...fixture(), mentions: [fixture().mentions[0]!, ...Array.from({ length: 13 }, (_, n) => post(`2026-11-0${2 + (n % 6)}T09:00:00Z`, n % 2, `Mention ${n}`, n))] }
    const host = x(many, 2)
    const list = run(host, { maxCalls: 3 })
    const ids: string[] = []
    const gaps: unknown[] = []
    let page = await list({ source: "mentions", account: ACCOUNT, since: SINCE, limit: 2 })
    for (let calls = 0; calls < 60; calls++) {
      ids.push(...page.events.map((event) => event.external_id))
      if (page.gap !== undefined) gaps.push(page.gap)
      if (!page.more) break
      page = await list({ source: "mentions", account: ACCOUNT, cursor: page.cursor, limit: 2 })
    }
    expect(gaps).toEqual([])
    expect(ids).toEqual(many.mentions.slice(1).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((item) => item.id))
    expect(host.calls.some((call) => call.input["until_id"] !== undefined)).toBe(true)
  })

  test("over every call cap, page size, limit and window size, with posts arriving mid-read, nothing repeats, nothing is skipped, and no gap", async () => {
    for (const maxCalls of [2, 3, 4]) {
      for (const pageSize of [1, 2, 3]) {
        for (const limit of [1, 2, 5]) {
          for (const n of [1, 5, 13]) {
            const data = { ...fixture(), mentions: [fixture().mentions[0]!, ...Array.from({ length: n }, (_, k) => post(`2026-11-0${2 + (k % 6)}T09:00:00Z`, k % 2, `Mention ${k}`, k))] }
            const host = x(data, pageSize)
            const list = run(host, { maxCalls })
            const ids: string[] = []
            let page = await list({ source: "mentions", account: ACCOUNT, since: SINCE, limit })
            let calls = 0
            for (; calls < 400; calls++) {
              expect(page.gap).toBeUndefined()
              ids.push(...page.events.map((event) => event.external_id))
              if (calls === 3) host.data.mentions.push(post("2026-11-09T09:00:00Z", 0, "Arrived mid-read", 90), post("2026-11-09T10:00:00Z", 1, "Arrived too", 91))
              if (!page.more && calls > 3) break
              page = await list({ source: "mentions", account: ACCOUNT, cursor: page.cursor, limit })
            }
            expect(calls).toBeLessThan(400)
            const want = host.data.mentions.slice(1).map((item) => item.id).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
            expect([maxCalls, pageSize, limit, n, ids]).toEqual([maxCalls, pageSize, limit, n, want])
          }
        }
      }
    }
  })

  /** Every page of one read, from `first` until `more` is false: the ids in order and every gap answered. */
  async function read(list: (input: EventsListInput) => Promise<EventsListResult>, first: EventsListInput, rest: EventsListInput) {
    const ids: string[] = []
    const gaps: unknown[] = []
    let page = await list(first)
    for (let calls = 0; calls < 500; calls++) {
      ids.push(...page.events.map((event) => event.external_id))
      if (page.gap !== undefined) gaps.push(page.gap)
      if (!page.more) return { ids, gaps, cursor: page.cursor }
      page = await list({ ...rest, cursor: page.cursor })
    }
    throw new Error("the read did not end")
  }
  const ascending = (items: readonly { id: string }[]) => items.map((item) => item.id).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))

  test("a gap is answered once per read across many small pages, and the next read minutes later neither gaps nor skips", async () => {
    for (const feed of ["mentions", "timeline"] as const) {
      const host = x(fixture(), 1)
      const list = run(host, { maxCalls: 2 })
      const first = await read(list, { source: feed, account: ACCOUNT, since: SINCE, limit: 1 }, { source: feed, account: ACCOUNT, limit: 1 })
      expect(first.gaps).toEqual([])
      // X moved on past everything listed: nine newer posts, and nothing from as far back as the newest one listed.
      const newer = Array.from({ length: 9 }, (_, n) => post("2026-11-06T09:00:00Z", n % 2, `Newer ${n}`, n))
      host.data[feed] = [...newer]
      const gapped = await read(list, { source: feed, account: ACCOUNT, cursor: first.cursor, limit: 1 }, { source: feed, account: ACCOUNT, limit: 1 })
      expect(gapped.gaps).toEqual([{ reason: "expired", since: fixture()[feed].at(-1)!.created_at }])
      expect(gapped.ids).toEqual(ascending(newer))
      // Minutes later one more post arrives: the read starts from the cursor, not from now, so it lists that post and
      // answers no gap.
      const late = post("2026-11-06T09:05:00Z", 1, "Minutes later", 20)
      host.data[feed].push(late)
      const later = run(host, { maxCalls: 2, now: () => NOW + 10 * 60_000 })
      const next = await read(later, { source: feed, account: ACCOUNT, cursor: gapped.cursor, limit: 1 }, { source: feed, account: ACCOUNT, limit: 1 })
      expect([next.gaps, next.ids]).toEqual([[], [late.id]])
    }
  })

  // Review L1, L1b and the probes R1, R1b and R1c: X may move past a paused read between any two of its calls.
  for (const [probe, pause] of [["R1c", 60_000], ["R1b", 30 * 60_000], ["R1", 3 * 86_400_000]] as const) {
    test(`${probe}: a read paused mid-way and resumed ${pause / 60_000} minutes later, after X moved past it, answers gap once`, async () => {
      for (const feed of ["mentions", "timeline"] as const) {
        const host = x(fixture(), 1)
        const list = run(host, { maxCalls: 2 })
        const first = await read(list, { source: feed, account: ACCOUNT, since: SINCE, limit: 1 }, { source: feed, account: ACCOUNT, limit: 1 })
        const wave = Array.from({ length: 5 }, (_, n) => post("2026-11-06T09:00:00Z", n % 2, `Wave ${n}`, n))
        host.data[feed].push(...wave)
        const paused = await list({ source: feed, account: ACCOUNT, cursor: first.cursor, limit: 1 })
        expect([paused.more, paused.gap, paused.events]).toEqual([true, undefined, []])
        // While paused, X moved past the wave's older part and everything before it.
        const after = Array.from({ length: 3 }, (_, n) => post("2026-11-07T09:00:00Z", n % 2, `After ${n}`, 50 + n))
        host.data[feed] = [...wave.slice(3), ...after]
        const later = run(host, { maxCalls: 2, now: () => NOW + pause })
        const resumed = await read(later, { source: feed, account: ACCOUNT, cursor: paused.cursor, limit: 1 }, { source: feed, account: ACCOUNT, limit: 1 })
        // Wave 0 to 2 are gone, inside a declared gap from the newest post listed: never lost silently.
        expect([feed, resumed.gaps]).toEqual([feed, [{ reason: "expired", since: fixture()[feed].at(-1)!.created_at }]])
        expect(resumed.ids).toEqual(ascending([...wave.slice(3), ...after]))
        expect((await read(later, { source: feed, account: ACCOUNT, cursor: resumed.cursor }, { source: feed, account: ACCOUNT })).gaps).toEqual([])
      }
    })
  }

  // Review L1c and L1d, the probes R1e and R1d: X moves past a read between two of its calls, after it listed a post.
  // R1e's wave is a minute apart; R1d's shares one second with the posts X still lists, so only a check by id sees it.
  for (const [probe, spaced] of [["R1e", true], ["R1d", false]] as const) {
    test(`${probe}: X moves past a read between two of its calls, after the read listed a post: gap once`, async () => {
      for (const feed of ["mentions", "timeline"] as const) {
        for (const minutes of [1, 30]) {
          const host = x(fixture(), 10)
          const list = run(host, { maxCalls: 4 })
          const first = await read(list, { source: feed, account: ACCOUNT, since: SINCE }, { source: feed, account: ACCOUNT })
          const wave = Array.from({ length: 5 }, (_, n) => post(spaced ? `2026-11-06T09:0${n}:00Z` : "2026-11-06T09:00:00Z", n % 2, `Wave ${n}`, n))
          host.data[feed].push(...wave)
          const p1 = await list({ source: feed, account: ACCOUNT, cursor: first.cursor, limit: 1 })
          expect([p1.more, p1.gap, p1.events.map((event) => event.title)]).toEqual([true, undefined, ["Wave 0"]])
          // Between the calls X passes its reach: the read's older remaining posts and everything before are gone, while
          // posts of the same second as the one listed may remain (R1d).
          const after = Array.from({ length: 3 }, (_, n) => post("2026-11-07T09:00:00Z", n % 2, `After ${n}`, 50 + n))
          host.data[feed] = [...wave.slice(3), ...after]
          const later = run(host, { maxCalls: 4, now: () => NOW + minutes * 60_000 })
          const resumed = await read(later, { source: feed, account: ACCOUNT, cursor: p1.cursor, limit: 1 }, { source: feed, account: ACCOUNT, limit: 1 })
          // Wave 1 and 2 are gone, inside a declared gap from the post listed: never lost silently.
          expect([feed, minutes, resumed.gaps]).toEqual([feed, minutes, [{ reason: "expired", since: wave[0]!.created_at }]])
          expect(resumed.ids).toEqual(ascending([...wave.slice(3), ...after]))
        }
      }
    })
  }

  test("R6: every call checks by id, and the check never takes a read from maxCalls: 2, page 1, 40 posts drain", async () => {
    for (const feed of ["mentions", "timeline"] as const) {
      const data = fixture()
      data[feed] = [data[feed][0]!, ...Array.from({ length: 40 }, (_, n) => post(`2026-11-0${2 + (n % 6)}T09:00:00Z`, n % 2, `P ${n}`, n))]
      const host = x(data, 1)
      const list = run(host, { maxCalls: 2 })
      let page = await list({ source: feed, account: ACCOUNT, since: SINCE, limit: 3 })
      const ids: string[] = [...page.events.map((event) => event.external_id)]
      let calls = 1
      for (; page.more && calls < 400; calls++) {
        const at = host.calls.length
        const listedBefore = ids.length
        page = await list({ source: feed, account: ACCOUNT, cursor: page.cursor, limit: 3 })
        ids.push(...page.events.map((event) => event.external_id))
        const made = host.calls.slice(at)
        // One check on every call (by id once the read has a post, from its start before), and the two reads maxCalls
        // allows besides it.
        const checks = made.filter((call) => call.input["post.fields"] === "created_at")
        expect(checks).toHaveLength(1)
        expect(checks[0]!.input[listedBefore > 0 ? "until_id" : "end_time"]).toBeDefined()
        expect(made.length - checks.length).toBeLessThanOrEqual(2)
        expect(page.gap).toBeUndefined()
      }
      expect(calls).toBeLessThan(400)
      expect(ids).toEqual(ascending(data[feed].slice(1)))
    }
  })

  test("a v0.0.5 cursor, with no w, is checked on its first read from its post's own time (review L2)", async () => {
    for (const feed of ["mentions", "timeline"] as const) {
      const host = x(fixture(), 10)
      const list = run(host)
      const first = await list({ source: feed, account: ACCOUNT, since: SINCE })
      const binding = { plugin: "x", source: feed, account: ACCOUNT }
      const decoded = decodeBoundCursor(binding, first.cursor)
      if (!decoded.ok) throw new Error("the cursor did not decode")
      const state = decoded.state as { a: string; i: string; l: string; p: { s: string } }
      // v0.0.5's cursor holds only the post it listed last.
      const legacy = encodeBoundCursor(binding, { a: state.a, i: state.i, l: state.l, p: { s: state.p.s } })
      // X still lists that post: no gap, and what came after is listed.
      host.data[feed].push(post("2026-11-06T09:00:00Z", 0, "New", 1))
      const fine = await list({ source: feed, account: ACCOUNT, cursor: legacy })
      expect([fine.gap, fine.events.map((event) => event.title)]).toEqual([undefined, ["New"]])
      expect(host.calls.at(-2)!.input["until_id"]).toBe((BigInt(state.p.s) + 1n).toString())
      // X moved past it: one gap from that post's own time, read from its id.
      host.data[feed] = Array.from({ length: 2 }, (_, n) => post("2026-11-07T09:00:00Z", 1, `Kept ${n}`, 10 + n))
      const stale = await list({ source: feed, account: ACCOUNT, cursor: legacy })
      expect(stale.gap).toEqual({ reason: "expired", since: fixture()[feed].at(-1)!.created_at })
      expect(stale.events.map((event) => event.title)).toEqual(["Kept 0", "Kept 1"])
      expect((await list({ source: feed, account: ACCOUNT, cursor: stale.cursor })).gap).toBeUndefined()
    }
  })

  test("a first listing's window-truncated gap is answered once across small pages, from its own start, never from now", async () => {
    const data = fixture()
    data.mentions.shift()
    const host = x(data, 1)
    const list = run(host, { maxCalls: 2 })
    const first = await read(list, { source: "mentions", account: ACCOUNT, since: SINCE, limit: 1 }, { source: "mentions", account: ACCOUNT, limit: 1 })
    expect(first.gaps).toEqual([{ reason: "window-truncated", since: SINCE_ISO }])
    expect(first.ids).toEqual(ascending(data.mentions))
    const late = post("2026-11-03T09:00:00Z", 0, "Later", 30)
    host.data.mentions.push(late)
    const next = await read(run(host, { maxCalls: 2, now: () => NOW + 10 * 60_000 }), { source: "mentions", account: ACCOUNT, cursor: first.cursor, limit: 1 }, { source: "mentions", account: ACCOUNT, limit: 1 })
    expect([next.gaps, next.ids]).toEqual([[], [late.id]])
  })

  test("a burst of posts with one timestamp, larger than a page and the call cap, drains: the cursor walks by post id", async () => {
    for (const feed of ["mentions", "timeline"] as const) {
      for (const [pageSize, maxCalls, limit] of [[1, 2, 1], [2, 2, 3], [3, 3, 2], [5, 4, 100]] as const) {
        const data = fixture()
        const burst = Array.from({ length: 17 }, (_, n) => post("2026-11-03T09:00:00Z", n % 2, `Same second ${n}`, n))
        data[feed] = [data[feed][0]!, ...burst]
        const host = x(data, pageSize)
        const list = run(host, { maxCalls })
        const first = await read(list, { source: feed, account: ACCOUNT, since: SINCE, limit }, { source: feed, account: ACCOUNT, limit })
        expect([pageSize, maxCalls, limit, first.gaps, first.ids]).toEqual([pageSize, maxCalls, limit, [], ascending(burst)])
        // Another burst at the same second as the last one listed, after the cursor: it drains too.
        const more = Array.from({ length: 11 }, (_, n) => post("2026-11-03T09:00:00Z", n % 2, `Same second again ${n}`, 100 + n))
        host.data[feed].push(...more)
        const next = await read(list, { source: feed, account: ACCOUNT, cursor: first.cursor, limit }, { source: feed, account: ACCOUNT, limit })
        expect([next.gaps, next.ids]).toEqual([[], ascending(more)])
      }
    }
  })

  test("bookmarks: a walk of X's whole 800 in small pages answers its gap once, and drains", async () => {
    const host = x(fixture(), 7)
    const list = run(host, { maxCalls: 3 })
    const first = await list({ source: "bookmarks", account: ACCOUNT })
    const many = Array.from({ length: 800 }, (_, n) => post("2026-11-08T09:00:00Z", n % 2, `Saved ${n}`, n))
    host.data.bookmarks = many
    const walked = await read(list, { source: "bookmarks", account: ACCOUNT, cursor: first.cursor, limit: 13 }, { source: "bookmarks", account: ACCOUNT, limit: 13 })
    expect(walked.gaps).toEqual([{ reason: "expired", since: new Date(NOW).toISOString() }])
    expect(new Set(walked.ids).size).toBe(800)
    const next = await read(run(host, { maxCalls: 3, now: () => NOW + 10 * 60_000 }), { source: "bookmarks", account: ACCOUNT, cursor: walked.cursor }, { source: "bookmarks", account: ACCOUNT })
    expect([next.gaps, next.ids]).toEqual([[], []])
  })

  test("a cursor from further back than X still lists answers gap expired once, with what X still lists", async () => {
    const host = x()
    const list = run(host)
    const first = await list({ source: "timeline", account: ACCOUNT, since: SINCE })
    const newest = fixture().timeline.at(-1)!
    // X moved on: it lists nothing from as far back as the newest post listed, and two newer posts arrived.
    host.data.timeline = [post("2026-11-06T09:00:00Z", 0, "Newer one"), post("2026-11-07T09:00:00Z", 1, "Newer two")]
    const next = await list({ source: "timeline", account: ACCOUNT, cursor: first.cursor })
    expect(next.gap).toEqual({ reason: "expired", since: newest.created_at })
    expect(next.events.map((event) => event.title)).toEqual(["Newer one", "Newer two"])
    const after = await list({ source: "timeline", account: ACCOUNT, cursor: next.cursor })
    expect([after.gap, after.events]).toEqual([undefined, []])
  })

  test("a deleted post loses nothing: no gap when X still lists an older one", async () => {
    const host = x()
    const list = run(host)
    const first = await list({ source: "mentions", account: ACCOUNT, since: SINCE })
    // The newest mention listed is deleted; the older ones are still listed.
    host.data.mentions.pop()
    host.data.mentions.push(post("2026-11-06T09:00:00Z", 1, "A new mention"))
    const next = await list({ source: "mentions", account: ACCOUNT, cursor: first.cursor })
    expect(next.gap).toBeUndefined()
    expect(next.events.map((event) => event.title)).toEqual(["A new mention"])
  })

  test("a first listing from further back than X still lists answers gap window-truncated from its start", async () => {
    const data = fixture()
    data.mentions.shift()
    const page = await run(x(data))({ source: "mentions", account: ACCOUNT, since: SINCE })
    expect(page.gap).toEqual({ reason: "window-truncated", since: SINCE_ISO })
    expect(page.events.map((event) => event.external_id)).toEqual(data.mentions.map((item) => item.id))
  })

  test("bookmarks: a walk that meets none of the known ones answers gap only after as many as X lists", async () => {
    const host = x(fixture(), 2)
    const list = run(host)
    const first = await list({ source: "bookmarks", account: ACCOUNT })
    // Every known bookmark removed and one added: a short walk, so they were removed, and nothing is lost.
    host.data.bookmarks = [post("2026-11-07T09:00:00Z", 0, "New bookmark")]
    const next = await list({ source: "bookmarks", account: ACCOUNT, cursor: first.cursor })
    expect([next.gap, next.events.map((event) => event.title)]).toEqual([undefined, ["New bookmark"]])
    // 800 bookmarks added, as many as X lists: the walk meets no known one, so older ones may be missing.
    const many = Array.from({ length: 800 }, (_, n) => post("2026-11-08T09:00:00Z", n % 2, `Saved ${n}`, n))
    host.data.bookmarks = many
    const ids: string[] = []
    const gaps: unknown[] = []
    let page = await list({ source: "bookmarks", account: ACCOUNT, cursor: next.cursor, limit: 500 })
    for (let calls = 0; calls < 400; calls++) {
      ids.push(...page.events.map((event) => event.external_id))
      if (page.gap !== undefined) gaps.push(page.gap)
      if (!page.more) break
      page = await list({ source: "bookmarks", account: ACCOUNT, cursor: page.cursor, limit: 500 })
    }
    expect(gaps).toEqual([{ reason: "expired", since: new Date(NOW).toISOString() }])
    expect(ids).toHaveLength(800)
    expect((await list({ source: "bookmarks", account: ACCOUNT, cursor: page.cursor })).gap).toBeUndefined()
  })

  test("source x answers no gap, as contract 1 lists", async () => {
    const data = fixture()
    data.mentions.shift()
    expect((await run(x(data))({ since: SINCE })).gap).toBeUndefined()
  })

  test("refuses for good a post that holds a secret, and moves its cursor past it", async () => {
    const data = fixture()
    data.mentions.unshift(post("2026-11-03T09:00:00Z", 1, "@SamRivera the files are at https://pilot:Wq7rZp4xLm9@files.example.net/share"))
    const list = run(x(data))
    const result = await list({ source: "mentions", account: ACCOUNT, since: SINCE })
    expect(result.refused).toEqual([{ external_id: data.mentions[0]!.id, reason: "secret", detail: "holds a secret (connection string)" }])
    expect(result.events.map((event) => event.external_id)).not.toContain(data.mentions[0]!.id)
    expect((await list({ source: "mentions", account: ACCOUNT, cursor: result.cursor })).events).toEqual([])
    // Source x keeps contract 1's answers: it lists the post.
    expect((await list({ since: SINCE })).events.map((event) => event.external_id)).toContain(data.mentions[0]!.id)
  })
})

describe("probe", () => {
  const call: ToolCall = { sessionID: "ses_1", agent: "build", messageID: "msg_script", id: "script:1", signal: new AbortController().signal, progress: async () => {} }

  test("asserts x_probe, reads who is signed in once, and answers the owner, the cost and nothing else", async () => {
    const host = x()
    const asserts: unknown[] = []
    const answer = await probeMethod(options(host, {}, asserts)).run({ source: "bookmarks", account: "samrivera" }, call)
    expect(answer).toEqual({ source: "bookmarks", account: "samrivera", owner: OWNER, cost: { units: [{ per: "user", count: 1 }] }, trust: "untrusted" })
    expect(host.calls.map((entry) => entry.tool)).toEqual(["x_get_users_me"])
    expect(asserts).toEqual([{ sessionID: "ses_1", agent: "build", action: PROBE_ACTION, resources: ["*"], source: { type: "tool", messageID: "msg_script", id: "script:1" } }])
    expect(PROBE_ACTION).toBe("x_probe")
    expect((await probeMethod(options()).run({}, call)) as unknown).toMatchObject({ source: "x", account: "samrivera" })
  })

  test("refuses another account, a feed that is off, an unknown source and any other input", async () => {
    const method = probeMethod(options(x(), { feeds: ["mentions"] }))
    await expect(method.run({ account: "someoneelse" }, call)).rejects.toThrow(/^ACCOUNT_MISMATCH: X is signed in to another account than "someoneelse"\. Next step: .*"samrivera"/)
    await expect(method.run({ source: "timeline" }, call)).rejects.toThrow(/^SOURCE_DISABLED: /)
    await expect(method.run({ source: "likes" }, call)).rejects.toThrow(/^SOURCE_UNKNOWN: /)
    await expect(method.run({ cursor: "abc" }, call)).rejects.toThrow(/^INPUT_INVALID: The probe input is invalid/)
    const signIn = { state: "sign_in_required", code: "AUTH_REQUIRED", message: "Sign in to X.", nextStep: "Run /connect and choose X." } as unknown as Status
    await expect(probeMethod({ ...options(), tool: { list: async () => [] } as never, status: async () => signIn }).run({}, call)).rejects.toThrow("AUTH_REQUIRED: Sign in to X; probe cannot call get_users_me. Next step: Run /connect and choose X.")
  })
})
