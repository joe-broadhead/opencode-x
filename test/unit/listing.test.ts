// The listing watcher: when the x server's status last changed, so status can tell "still listing" from "none".
import { describe, expect, test } from "bun:test"
import { watchListing } from "../../src/listing.js"

/** An event stream the test feeds by hand, ending when its signal aborts. */
function events() {
  const queue: unknown[] = []
  let wake: (() => void) | undefined
  const push = (event: unknown) => (queue.push(event), wake?.())
  const subscribe = ({ signal }: { signal: AbortSignal }) => ({
    async *[Symbol.asyncIterator]() {
      while (!signal.aborted) {
        if (queue.length) yield queue.shift()
        else await new Promise<void>((resolve) => ((wake = resolve), signal.addEventListener("abort", () => resolve(), { once: true })))
      }
    },
  })
  return { push, event: { subscribe } as never }
}

describe("watchListing", () => {
  test("starts at setup, moves on a status change of the x server only, and stops cleanly", async () => {
    const stream = events()
    const before = Date.now()
    const listing = watchListing(stream)
    const started = listing.changedAt()
    expect(started).toBeGreaterThanOrEqual(before)
    await Bun.sleep(5)
    stream.push({ type: "mcp.status.changed", data: { server: "github" } })
    await Bun.sleep(5)
    expect(listing.changedAt()).toBe(started)
    stream.push({ type: "mcp.status.changed", data: { server: "x" } })
    await Bun.sleep(5)
    expect(listing.changedAt()).toBeGreaterThan(started)
    await listing.stop()
  })
})
