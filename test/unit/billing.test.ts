import { describe, expect, test } from "bun:test"
import { costLine, costOf, mergeCosts } from "../../src/billing.js"

const content = (value: unknown) => [{ type: "text", text: JSON.stringify(value) }]
const search = (posts: number, users = posts) => ({
  data: Array.from({ length: posts }, (_, index) => ({ id: String(index), author_id: String(index) })),
  includes: { users: Array.from({ length: users }, (_, index) => ({ id: String(index) })) },
  meta: { result_count: posts },
})

// The plugin's own tool results carry these lines: x_events_list's summary and the tools RPC's script results. There
// is no per-request cost hook, so a model-path MCP result never gets one.
describe("the cost line", () => {
  test("counts the posts and authors X actually returned", () => {
    const cost = costOf("x_search_posts_all", { output: search(10) })!
    expect(costLine(cost)).toBe("Cost: at most 10 posts ($0.05) + 10 authors ($0.10) = $0.15.")
    const one = costOf("x_search_posts_all", { output: search(1) })!
    expect(costLine(one)).toBe("Cost: at most 1 post ($0.005) + 1 author ($0.01) = $0.015.")
  })

  test("uses the owned-read rate for mentions and the user rate for a profile", () => {
    const mentions = costOf("x_get_users_mentions", { content: content(search(3, 0)) })!
    expect(costLine(mentions)).toBe("Cost: at most 3 owned posts ($0.015) = $0.015.")
    const user = costOf("x_get_users_by_username", { output: { data: { id: "1" } } })!
    expect(costLine(user)).toBe("Cost: at most 1 user ($0.01) = $0.01.")
    const post = costOf("x_get_posts_by_id", { output: { data: { id: "1" }, includes: { users: [{ id: "1" }] } } })!
    expect(costLine(post)).toBe("Cost: at most 1 post ($0.005) + 1 author ($0.01) = $0.015.")
    expect(costLine(costOf("x_get_posts_counts_recent", {})!)).toBe("Cost: at most 1 count read ($0.01) = $0.01.")
  })

  test("states a zero cost for a completed read that returned nothing", () => {
    expect(costOf("x_search_posts_all", { output: undefined, content: [{ type: "text", text: "plain" }] })).toBeUndefined()
    expect(costLine(mergeCosts([]))).toBe("Cost: 0 posts + 0 authors = $0.00.")
    expect(costLine(costOf("x_search_posts_all", { output: { data: [], meta: { result_count: 0 } } })!)).toBe("Cost: 0 posts + 0 authors = $0.00.")
    expect(costLine(costOf("x_get_users_by_username", { output: { data: [] } })!)).toBe("Cost: 0 posts + 0 authors = $0.00.")
  })
})
