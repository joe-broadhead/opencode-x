import { describe, expect, test } from "bun:test"
import { clampRead, costLine, costOf, mergeCosts, registerBilling } from "../../src/billing.js"

type Handler = (event: Record<string, unknown>) => void

const hookEditor = () => {
  const handlers = new Map<string, Handler>()
  const registrations: string[] = []
  return {
    handlers,
    registrations,
    hook: async (name: string, handler: Handler) => {
      handlers.set(name, handler)
      registrations.push(name)
      return { dispose: async () => void registrations.splice(registrations.indexOf(name), 1) }
    },
  }
}

const content = (value: unknown) => [{ type: "text", text: JSON.stringify(value) }]
const search = (posts: number, users = posts) => ({
  data: Array.from({ length: posts }, (_, index) => ({ id: String(index), author_id: String(index) })),
  includes: { users: Array.from({ length: users }, (_, index) => ({ id: String(index) })) },
  meta: { result_count: posts },
})

describe("the read cap", () => {
  test("clamps a page to ten, sets an absent page size, and drops a next-page token", () => {
    const input: Record<string, unknown> = { query: "coffee", max_results: 50, next_token: "n", pagination_token: "p", expansions: "author_id" }
    clampRead("x_search_posts_all", input)
    expect(input).toEqual({ query: "coffee", max_results: 10, expansions: "author_id" })
    const absent: Record<string, unknown> = { query: "coffee" }
    clampRead("x_search_posts_all", absent)
    expect(absent.max_results).toBe(10)
    const small: Record<string, unknown> = { query: "coffee", max_results: 3 }
    clampRead("x_search_posts_all", small)
    expect(small.max_results).toBe(3)
    // A tool without a page size is left alone.
    const user: Record<string, unknown> = { username: "example" }
    clampRead("x_get_users_by_username", user)
    expect(user).toEqual({ username: "example" })
  })
})

describe("the cost line", () => {
  test("counts the posts and authors X actually returned", () => {
    const cost = costOf("x_search_posts_all", { output: search(10) })!
    expect(costLine(cost)).toBe("Cost: 10 posts ($0.05) + 10 authors ($0.10) = $0.15.")
    const one = costOf("x_search_posts_all", { output: search(1) })!
    expect(costLine(one)).toBe("Cost: 1 post ($0.005) + 1 author ($0.01) = $0.015.")
  })

  test("uses the owned-read rate for mentions and the user rate for a profile", () => {
    const mentions = costOf("x_get_users_mentions", { content: content(search(3, 0)) })!
    expect(costLine(mentions)).toBe("Cost: 3 owned posts ($0.003) = $0.003.")
    const user = costOf("x_get_users_by_username", { output: { data: { id: "1" } } })!
    expect(costLine(user)).toBe("Cost: 1 user ($0.01) = $0.01.")
    const post = costOf("x_get_posts_by_id", { output: { data: { id: "1" }, includes: { users: [{ id: "1" }] } } })!
    expect(costLine(post)).toBe("Cost: 1 post ($0.005) + 1 author ($0.01) = $0.015.")
    expect(costLine(costOf("x_get_posts_counts_recent", {})!)).toBe("Cost: 1 count read ($0.01) = $0.01.")
  })

  test("states a zero cost for a completed read that returned nothing", () => {
    expect(costOf("x_search_posts_all", { output: undefined, content: [{ type: "text", text: "plain" }] })).toBeUndefined()
    expect(costLine(mergeCosts([]))).toBe("Cost: 0 posts + 0 authors = $0.00.")
    expect(costLine(costOf("x_search_posts_all", { output: { data: [], meta: { result_count: 0 } } })!)).toBe("Cost: 0 posts + 0 authors = $0.00.")
    expect(costLine(costOf("x_get_users_by_username", { output: { data: [] } })!)).toBe("Cost: 0 posts + 0 authors = $0.00.")
  })

  test("adds one line to a direct read, and one summed line to the Code Mode result", async () => {
    const editor = hookEditor()
    const stop = await registerBilling(editor as never, () => true)
    const before = editor.handlers.get("execute.before")!
    const after = editor.handlers.get("execute.after")!

    const direct: Record<string, unknown> = { query: "coffee", max_results: 50, next_token: "n" }
    before({ sessionID: "s1", messageID: "m1", tool: "x_search_posts_all", input: direct })
    expect(direct).toMatchObject({ max_results: 10 })
    const result = { content: [{ type: "text", text: "called" }], output: search(10) } as Record<string, unknown>
    after({ sessionID: "s1", messageID: "m1", tool: "x_search_posts_all", status: "completed", result })
    expect(result.content).toEqual([{ type: "text", text: "called" }, { type: "text", text: "Cost: 10 posts ($0.05) + 10 authors ($0.10) = $0.15." }])

    // Code Mode: the inner read is summed, and the line goes on the execute result the model reads.
    before({ sessionID: "s2", messageID: "m2", tool: "execute", input: { code: "code" } })
    const inner = { content: [{ type: "text", text: "inner" }], output: search(2) } as Record<string, unknown>
    after({ sessionID: "s2", messageID: "m2", tool: "x_search_posts_all", status: "completed", result: inner })
    expect(inner.content).toEqual([{ type: "text", text: "inner" }])
    const outer = { content: [{ type: "text", text: "program output" }] } as Record<string, unknown>
    after({ sessionID: "s2", messageID: "m2", tool: "execute", status: "completed", result: outer })
    expect(outer.content).toEqual([{ type: "text", text: "program output" }, { type: "text", text: "Cost: 2 posts ($0.01) + 2 authors ($0.02) = $0.03." }])
    await stop()
    expect(editor.registrations).toEqual([])
  })
})
