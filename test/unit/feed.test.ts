// The feed walk: a window the call cap cannot finish is narrowed instead of skipped, and a first listing starts 24
// hours back when no `since` is named. Every page here is the synthetic X's.
import { describe, expect, test } from "bun:test"
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

  test("a first listing without since starts 24 hours back", async () => {
    const run = harness()
    const page = (await run.handlers.events_list!.run({ source: "mentions" }, run.call("work"))) as { events: unknown[]; cost: { units: { per: string; count: number }[] } }
    expect(page.events).toEqual([])
    expect(page.cost.units).toEqual([{ per: "user", count: 1 }])
  })
})
