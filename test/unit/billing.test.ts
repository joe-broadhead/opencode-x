import { describe, expect, test } from "bun:test"
import { costLine, costOf, mergeCosts, registerBilling } from "../../src/billing.js"

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

describe("no read cap on the model path", () => {
  test("a read's page size and next-page token reach X unchanged, and X's next-page token reaches the model", async () => {
    const editor = hookEditor()
    const stop = await registerBilling(editor as never, () => true)
    const before = editor.handlers.get("execute.before")!
    const after = editor.handlers.get("execute.after")!
    const input: Record<string, unknown> = { query: "coffee", max_results: 100, next_token: "n", pagination_token: "p", expansions: "author_id" }
    before({ sessionID: "s9", messageID: "m9", tool: "x_search_posts_all", input })
    expect(input).toEqual({ query: "coffee", max_results: 100, next_token: "n", pagination_token: "p", expansions: "author_id" })
    const absent: Record<string, unknown> = { query: "coffee" }
    before({ sessionID: "s9", messageID: "m9", tool: "x_search_posts_all", input: absent })
    expect(absent).toEqual({ query: "coffee" })
    const answer = { ...search(100), meta: { result_count: 100, next_token: "page-2" } }
    const result = { content: content(answer), output: answer } as Record<string, unknown>
    after({ sessionID: "s9", messageID: "m9", tool: "x_search_posts_all", status: "completed", result })
    expect(result.output).toMatchObject({ meta: { next_token: "page-2" } })
    expect(result.content).toEqual([...content(answer), { type: "text", text: "Cost: at most 100 posts ($0.50) + 100 authors ($1.00) = $1.50." }])
    await stop()
  })
})

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

  test("adds one line to a direct read, and one summed line to the Code Mode result", async () => {
    const editor = hookEditor()
    const stop = await registerBilling(editor as never, () => true)
    const before = editor.handlers.get("execute.before")!
    const after = editor.handlers.get("execute.after")!

    const direct: Record<string, unknown> = { query: "coffee", max_results: 50, next_token: "n" }
    before({ sessionID: "s1", messageID: "m1", tool: "x_search_posts_all", input: direct })
    expect(direct).toEqual({ query: "coffee", max_results: 50, next_token: "n" })
    const result = { content: [{ type: "text", text: "called" }], output: search(10) } as Record<string, unknown>
    after({ sessionID: "s1", messageID: "m1", tool: "x_search_posts_all", status: "completed", result })
    expect(result.content).toEqual([{ type: "text", text: "called" }, { type: "text", text: "Cost: at most 10 posts ($0.05) + 10 authors ($0.10) = $0.15." }])

    // Code Mode: the inner read is summed, and the line goes on the execute result the model reads.
    before({ sessionID: "s2", messageID: "m2", tool: "execute", input: { code: "code" } })
    const inner = { content: [{ type: "text", text: "inner" }], output: search(2) } as Record<string, unknown>
    after({ sessionID: "s2", messageID: "m2", tool: "x_search_posts_all", status: "completed", result: inner })
    expect(inner.content).toEqual([{ type: "text", text: "inner" }])
    const outer = { content: [{ type: "text", text: "program output" }] } as Record<string, unknown>
    after({ sessionID: "s2", messageID: "m2", tool: "execute", status: "completed", result: outer })
    expect(outer.content).toEqual([{ type: "text", text: "program output" }, { type: "text", text: "Cost: at most 2 posts ($0.01) + 2 authors ($0.02) = $0.03." }])
    await stop()
    expect(editor.registrations).toEqual([])
  })

  test("adds no cost line to a Code Mode result that made no X call", async () => {
    const editor = hookEditor()
    const stop = await registerBilling(editor as never, () => true)
    const before = editor.handlers.get("execute.before")!
    const after = editor.handlers.get("execute.after")!

    before({ sessionID: "s3", messageID: "m3", tool: "execute", input: { code: "return 1" } })
    const outer = { content: [{ type: "text", text: "1" }] } as Record<string, unknown>
    after({ sessionID: "s3", messageID: "m3", tool: "execute", status: "completed", result: outer })
    expect(outer.content).toEqual([{ type: "text", text: "1" }])

    // A failed execute with no X call is left alone too.
    before({ sessionID: "s4", messageID: "m4", tool: "execute", input: { code: "throw new Error('x')" } })
    const failed = { content: [{ type: "text", text: "boom" }] } as Record<string, unknown>
    after({ sessionID: "s4", messageID: "m4", tool: "execute", status: "error", result: failed })
    expect(failed.content).toEqual([{ type: "text", text: "boom" }])
    await stop()
  })

  test("a Code Mode X call that returned nothing still gets the zero line", async () => {
    const editor = hookEditor()
    const stop = await registerBilling(editor as never, () => true)
    const before = editor.handlers.get("execute.before")!
    const after = editor.handlers.get("execute.after")!

    before({ sessionID: "s5", messageID: "m5", tool: "execute", input: { code: "code" } })
    const inner = { content: [{ type: "text", text: "empty" }], output: { data: [], meta: { result_count: 0 } } } as Record<string, unknown>
    after({ sessionID: "s5", messageID: "m5", tool: "x_search_posts_all", status: "completed", result: inner })
    const outer = { content: [{ type: "text", text: "[]" }] } as Record<string, unknown>
    after({ sessionID: "s5", messageID: "m5", tool: "execute", status: "completed", result: outer })
    expect(outer.content).toEqual([{ type: "text", text: "[]" }, { type: "text", text: "Cost: 0 posts + 0 authors = $0.00." }])
    await stop()
  })
})
