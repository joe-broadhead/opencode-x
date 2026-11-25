// The feed walk: a window the call cap cannot finish is narrowed instead of skipped, and a first listing starts 24
// hours back when no `since` is named. Every page here is the synthetic X's.
import { describe, expect, test } from "bun:test"
import { savePost } from "../support/fake-x.js"
import { harness } from "../support/handlers.js"

const SINCE = "2026-11-01T00:00:00.000Z"

/** Read a feed to its end, following each page's cursor; returns every event's external id, in order. */
async function drain(run: ReturnType<typeof harness>, source: "mentions" | "bookmarks" | "timeline", account = "work", limit = 1) {
  const ids: string[] = []
  let cursor: string | undefined
  for (let call = 0; call < 12; call++) {
    const page = (await run.handlers.events_list!.run({ source, limit, ...(cursor === undefined ? { since: SINCE } : { cursor }) }, run.call(account))) as {
      events: { external_id: string }[]
      cursor: string
      more: boolean
    }
    ids.push(...page.events.map((event) => event.external_id))
    cursor = page.cursor
    if (!page.more) return ids
  }
  throw new Error("the feed did not end within 12 calls")
}

describe("the feed walk", () => {
  test("a window the cap cannot finish is narrowed, and no post is skipped", async () => {
    const run = harness({ maxCalls: 3 })
    expect(await drain(run, "mentions", "work", 1)).toEqual(["9001", "9002"])
  })

  test("the smallest read budget still makes progress on a cursor", async () => {
    const run = harness({ maxCalls: 2 })
    expect(await drain(run, "mentions", "work", 1)).toEqual(["9001", "9002"])
  })

  test("since with limit 1 pages each feed to its end and lists every event exactly once", async () => {
    const run = harness()
    const expected = {
      mentions: ["9001", "9002"],
      timeline: ["9201", "9202"],
      bookmarks: ["bookmark:9101"],
    }
    for (const [source, ids] of Object.entries(expected) as [keyof typeof expected, string[]][]) {
      const listed = await drain(run, source, "work", 1)
      expect(listed).toEqual(ids)
      expect(new Set(listed).size).toBe(listed.length)
    }
  })

  test("two posts sharing created_at across a page boundary are both listed exactly once", async () => {
    // `same`'s timeline has two posts at 2026-11-21T09:00:00.000Z. A page holds one post, so the walk turns over
    // between them; the second call resumes by `since_id`, the total order, not by the shared timestamp.
    const run = harness({ maxCalls: 3, accounts: { work: {}, personal: {}, same: {} } })
    const first = (await run.handlers.events_list!.run({ source: "timeline", limit: 1, since: SINCE }, run.call("same"))) as {
      events: { external_id: string; occurred_at: string }[]
      cursor: string
      more: boolean
      gap?: unknown
    }
    expect(first.events.map((event) => event.external_id)).toEqual(["9601"])
    expect(first.more).toBe(true)
    expect(first.gap).toBeUndefined()
    const second = (await run.handlers.events_list!.run({ source: "timeline", limit: 1, cursor: first.cursor }, run.call("same"))) as {
      events: { external_id: string; occurred_at: string }[]
      cursor: string
      more: boolean
      gap?: unknown
    }
    expect(second.events.map((event) => event.external_id)).toEqual(["9602"])
    expect(second.more).toBe(false)
    expect(second.gap).toBeUndefined()
    expect([...first.events, ...second.events].map((event) => event.external_id)).toEqual(["9601", "9602"])
    expect(first.events[0]!.occurred_at).toBe("2026-11-21T09:00:00.000Z")
    expect(second.events[0]!.occurred_at).toBe(first.events[0]!.occurred_at)
    // The second page's feed read resumed after the first post's id, not after its timestamp.
    const resumed = run.fake.calls.filter((call) => call.account === "same" && call.tool === "get_users_timeline" && call.input["since_id"] !== undefined)
    expect(resumed.map((call) => call.input["since_id"])).toEqual(["9601"])
  })

  test("a timeline post created before the window is not listed after a cursor", async () => {
    // A post appears with a newer id but a created_at before the first listing's window: every page applies the
    // cursor's `t`, so the post stays outside the window.
    const run = harness({ accounts: { work: {}, personal: {}, same: {} } })
    const first = (await run.handlers.events_list!.run({ source: "timeline", limit: 1, since: SINCE }, run.call("same"))) as { cursor: string }
    const second = (await run.handlers.events_list!.run({ source: "timeline", cursor: first.cursor }, run.call("same"))) as {
      events: { external_id: string }[]
      cursor: string
      more: boolean
    }
    expect(second.events.map((event) => event.external_id)).toEqual(["9602"])
    expect(second.more).toBe(false)
    savePost("same", "timeline", {
      id: "9604",
      created: "2026-10-31T23:59:00.000Z",
      text: "An old post with a newer id.",
      conversation: "7604",
    })
    const third = (await run.handlers.events_list!.run({ source: "timeline", cursor: second.cursor }, run.call("same"))) as { events: unknown[] }
    expect(third.events).toEqual([])
  })

  test("a timeline page is listed oldest first", async () => {
    const run = harness()
    const page = (await run.handlers.events_list!.run({ source: "timeline", since: SINCE }, run.call("work"))) as { events: { external_id: string }[]; more: boolean }
    expect(page.events.map((event) => event.external_id)).toEqual(["9201", "9202"])
    expect(page.more).toBe(false)
  })

  test("a later call lists only what came after the cursor", async () => {
    const run = harness()
    const page = (await run.handlers.events_list!.run({ source: "timeline", since: SINCE }, run.call("work"))) as { cursor: string }
    const empty = (await run.handlers.events_list!.run({ source: "timeline", cursor: page.cursor }, run.call("work"))) as { events: unknown[]; more: boolean }
    expect(empty.events).toEqual([])
    expect(empty.more).toBe(false)
  })

  test("bookmarks walk to the known one and list nothing twice", async () => {
    const run = harness()
    const first = (await run.handlers.events_list!.run({ source: "bookmarks", since: SINCE }, run.call("work"))) as { cursor: string; events: unknown[] }
    const second = (await run.handlers.events_list!.run({ source: "bookmarks", cursor: first.cursor }, run.call("work"))) as { cursor: string; events: unknown[]; more: boolean }
    expect(second.events).toEqual([])
    expect(second.more).toBe(false)
  })

  test("a bookmark saved after the cursor is still filtered by the first since", async () => {
    // A post created before the window is saved after the first page: X lists bookmarks by save, not post time, so
    // the next page meets it. The cursor keeps `t`, and every page applies it, so the event stays outside the window.
    const run = harness({ accounts: { work: {}, personal: {}, same: {} } })
    const first = (await run.handlers.events_list!.run({ source: "bookmarks", limit: 1, since: SINCE }, run.call("same"))) as {
      events: { external_id: string }[]
      cursor: string
      more: boolean
    }
    expect(first.events.map((event) => event.external_id)).toEqual(["bookmark:9702"])
    expect(first.more).toBe(false)
    savePost("same", "bookmarks", {
      id: "9703",
      created: "2026-10-31T23:59:00.000Z",
      text: "An old post saved after the first page.",
      conversation: "7703",
    })
    const second = (await run.handlers.events_list!.run({ source: "bookmarks", cursor: first.cursor }, run.call("same"))) as { events: unknown[]; more: boolean; cursor: string }
    expect(second.events).toEqual([])
    expect(second.more).toBe(false)
    // A post created inside the window, saved after that page, is still listed next.
    savePost("same", "bookmarks", {
      id: "9704",
      created: "2026-11-22T09:00:00.000Z",
      text: "A post saved inside the window.",
      conversation: "7704",
    })
    const third = (await run.handlers.events_list!.run({ source: "bookmarks", cursor: second.cursor }, run.call("same"))) as { events: { external_id: string }[] }
    expect(third.events.map((event) => event.external_id)).toEqual(["bookmark:9704"])
  })

  test("a first listing without since starts 24 hours back", async () => {
    const run = harness()
    const page = (await run.handlers.events_list!.run({ source: "mentions" }, run.call("work"))) as { events: unknown[]; cost: { units: { per: string; count: number }[] } }
    expect(page.events).toEqual([])
    expect(page.cost.units).toEqual([{ per: "user", count: 1 }])
  })
})
