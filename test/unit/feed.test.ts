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
