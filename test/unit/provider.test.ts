// The provider: X's answer parsing, per-alias executor selection, and the contract code each host failure becomes.
import { describe, expect, test } from "bun:test"
import { createProvider, serverStates, type ProviderHost, type ToolExecutor } from "../../src/provider/index.js"
import { postsPage, userOf, type XResult } from "../../src/provider/parse.js"

const signal = new AbortController().signal
const call = { signal } as unknown as { readonly signal: AbortSignal }

const result = (payload: unknown): XResult => ({ content: [{ type: "text", text: JSON.stringify(payload) }] })

const executor = (id: string, answer: XResult | Error): ToolExecutor => ({
  id,
  async execute() {
    if (answer instanceof Error) throw answer
    return answer
  },
})

const host = (tools: readonly ToolExecutor[], servers: readonly { name: string; status: string; error?: string }[] = []): ProviderHost => ({
  tools: { list: async () => tools },
  servers: async () => servers as never,
})

describe("X's answers", () => {
  test("a user read names the id, the handle and the name", () => {
    const user = userOf("get_users_me", result({ data: { id: "1001", username: "AnaWork", name: "Ana Silva" } }))
    expect(user).toEqual({ id: "1001", username: "AnaWork", name: "Ana Silva" })
  })

  test("a posts page counts the posts and the authors it returned", () => {
    const page = postsPage(
      "get_users_mentions",
      result({
        data: [
          { id: "9001", text: "one", created_at: "2026-11-18T10:15:00.000Z", conversation_id: "7001", author_id: "2002" },
          { id: "9002", text: "two", created_at: "2026-11-18T10:31:00.000Z", conversation_id: "7001", author_id: "2001" },
        ],
        includes: { users: [{ id: "2002", username: "kaim", name: "Kai Mensah" }, { id: "2001", username: "anawork", name: "Ana Silva" }] },
        meta: { next_token: "offset:2" },
      }),
    )
    expect(page.posts.map((post) => post.id)).toEqual(["9001", "9002"])
    expect(page.posts[0]!.author).toEqual({ id: "2002", username: "kaim", name: "Kai Mensah" })
    expect(page.next).toBe("offset:2")
    expect({ posts: page.posts_read, authors: page.authors_read }).toEqual({ posts: 2, authors: 2 })
  })

  test("an answer that is not X's shape is UNAVAILABLE, never a guess", () => {
    expect(() => userOf("get_users_me", result({ data: { id: "x", username: "no spaces" } }))).toThrow(/UNAVAILABLE: X's get_users_me answered in a shape/)
    expect(() => postsPage("get_users_mentions", result({ errors: [{ detail: "Something went wrong" }] }))).toThrow(/UNAVAILABLE: X's get_users_mentions failed: Something went wrong/)
  })
})

describe("per-alias executors", () => {
  test("the work alias reads through x-work_ and never x_", async () => {
    const seen: string[] = []
    const tools = [
      { id: "x_get_users_me", async execute() { seen.push("x"); return result({ data: { id: "1000", username: "Wrong" } }) } },
      { id: "x-work_get_users_me", async execute() { seen.push("x-work"); return result({ data: { id: "1001", username: "AnaWork", name: "Ana Silva" } }) } },
    ]
    const answer = await createProvider(host(tools)).me("work", call)
    expect(seen).toEqual(["x-work"])
    expect(answer.user.username).toBe("AnaWork")
    expect(answer.cost).toEqual({ posts: 0, authors: 0, users: 1 })
  })

  test("each feed read uses its own tool", async () => {
    const seen: string[] = []
    const tools = [
      { id: "x_get_users_mentions", async execute() { seen.push("mentions"); return result({ data: [] }) } },
      { id: "x_get_users_bookmarks", async execute() { seen.push("bookmarks"); return result({ data: [] }) } },
      { id: "x_get_users_timeline", async execute() { seen.push("timeline"); return result({ data: [] }) } },
    ]
    const provider = createProvider(host(tools))
    await provider.page("default", "mentions", {}, call)
    await provider.page("default", "bookmarks", {}, call)
    await provider.page("default", "timeline", {}, call)
    expect(seen).toEqual(["mentions", "bookmarks", "timeline"])
  })
})

describe("failures", () => {
  test("a server that needs a sign-in is NEEDS_SIGN_IN with the credential redacted", async () => {
    const provider = createProvider(host([], [{ name: "x-work", status: "needs_auth", error: "the refresh token sk-abcdefghijklmnop was refused" }]))
    const failure = await provider.me("work", call).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: "NEEDS_SIGN_IN" })
    expect((failure as Error).message).toContain("Next step: ")
    expect((failure as Error).message).not.toContain("sk-abcdefghijklmnop")
  })

  test("a missing server names the server, not a tool", async () => {
    const provider = createProvider(host([], []))
    const failure = await provider.me("work", call).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: "UNAVAILABLE" })
    expect((failure as Error).message).toContain("x-work")
  })

  test("X's own failures map to its rate, scope and sign-in codes", async () => {
    const limited = createProvider(host([executor("x_get_users_me", Object.assign(new Error("429 Too Many Requests"), { _tag: "Tool.Error" }))]))
    expect(await limited.me("default", call).catch((error: unknown) => error)).toMatchObject({ code: "RATE_LIMITED" })
    const scope = createProvider(host([executor("x_get_users_me", Object.assign(new Error("403 Forbidden: missing scope"), { _tag: "Tool.Error" }))]))
    expect(await scope.me("default", call).catch((error: unknown) => error)).toMatchObject({ code: "SCOPE_MISSING" })
    const auth = createProvider(host([executor("x_get_users_me", Object.assign(new Error("401 Unauthorized: token expired"), { _tag: "Tool.Error" }))]))
    expect(await auth.me("default", call).catch((error: unknown) => error)).toMatchObject({ code: "NEEDS_SIGN_IN" })
  })

  test("a refused permission check reaches the caller unchanged", async () => {
    const blocked = Object.assign(new Error("denied"), { _tag: "Permission.BlockedError" })
    const provider = createProvider(host([executor("x_get_users_me", blocked)]))
    expect(await provider.me("default", call).catch((error: unknown) => error)).toBe(blocked)
  })

  test("ctx.mcp.list output is narrowed to the states status reads", () => {
    const states = serverStates({
      location: {},
      data: [
        { name: "x", status: "connected" },
        { name: "x-work", status: "needs_auth", error: "expired" },
        { name: "other", status: "not-a-status" },
      ],
    })
    expect(states).toEqual([
      { name: "x", status: "connected" },
      { name: "x-work", status: "needs_auth", error: "expired" },
    ])
  })
})
