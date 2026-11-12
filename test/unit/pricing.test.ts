import { describe, expect, test } from "bun:test"
import { billingStatus, configureBilling, costOf, estimateCall, flushBilling, recordModelCost, resetBilling, scriptCostOfCall } from "../../src/billing.js"
import { PRICES, PRICE_AS_OF, PRICE_SOURCE, priceOf } from "../../src/prices.js"
import { METHODS, pluginError, resetScriptSpend, shapeInput, shapeResult } from "../../src/host/tools-rpc.js"

const storage = () => {
  const data = new Map<string, unknown>()
  return { data, get: async (key: string) => data.get(key), set: async (key: string, value: unknown) => void data.set(key, value) }
}
const call = (sessionID = "ses_test") => ({ sessionID, agent: "build", action: "x_search_posts_all" })
const fresh = async (input: { sessionBudgetUsd?: number; dailyBudgetUsd?: number; ownsXApp?: boolean; store?: ReturnType<typeof storage> } = {}) => {
  resetScriptSpend()
  const store = input.store ?? storage()
  await configureBilling({ storage: store, sessionBudgetUsd: input.sessionBudgetUsd, dailyBudgetUsd: input.dailyBudgetUsd, ownsXApp: input.ownsXApp })
  return store
}

describe("the price table", () => {
  test("has one row for every known method, and no unknown row", () => {
    const names = METHODS.map((method) => method.name).sort()
    expect(Object.keys(PRICES).sort()).toEqual(names)
    expect(PRICE_SOURCE).toContain("docs.x.com")
    expect(PRICE_AS_OF).toBe("2026-11-08")
  })

  test("prices the published categories: a page of posts, a user, an owned read and a write", () => {
    expect(estimateCall("search_posts_all", { query: "q", max_results: 10 }).estimateUsd).toBe(0.05)
    expect(estimateCall("get_users_by_username", { username: "x" }).estimateUsd).toBe(0.01)
    expect(estimateCall("get_users_mentions", { id: "1", max_results: 10 }).estimateUsd).toBe(0.05)
    expect(estimateCall("create_users_bookmark", { id: "1" }).estimateUsd).toBe(0.005)
    expect(estimateCall("create_posts", { text: "hello" }).estimateUsd).toBe(0.015)
    expect(estimateCall("create_posts", { text: "see https://example.com" }).estimateUsd).toBe(0.2)
    expect(estimateCall("get_posts_counts_recent", { query: "q" }).estimateUsd).toBe(0.005)
  })

  test("refuses an unpriced method with X_PRICE_UNKNOWN", () => {
    expect(priceOf("not_a_tool")).toBeUndefined()
    expect(() => estimateCall("not_a_tool", {})).toThrow("no published X price")
    try {
      shapeInput("not_a_tool", {}, call())
    } catch (error) {
      expect(pluginError(error)?.code).toBe("X_PRICE_UNKNOWN")
    }
  })
})

describe("the budget", () => {
  test("is off by default: no session or daily cap, and status says so", async () => {
    const store = await fresh()
    expect(billingStatus()).toEqual({ dailySpentUsd: 0, dailyBudgetUsd: null, sessionBudgetUsd: null })
    // $1.50 in one session, then a reload and another session: nothing refuses, and the ledger still counts it.
    for (let read = 0; read < 30; read++) {
      shapeInput("search_posts_all", { query: "q", max_results: 10 }, call("ses_a"))
      shapeResult("search_posts_all", { output: { data: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })) }, text: "" }, call("ses_a"))
    }
    await flushBilling()
    await configureBilling({ storage: store })
    expect(() => shapeInput("search_posts_all", { query: "q", max_results: 100 }, call("ses_b"))).not.toThrow()
    expect(billingStatus().dailySpentUsd).toBe(1.5)
  })

  test("a large opt-in budget is honoured as set", async () => {
    await fresh({ sessionBudgetUsd: 5_000, dailyBudgetUsd: 25_000 })
    expect(billingStatus()).toMatchObject({ sessionBudgetUsd: 5_000, dailyBudgetUsd: 25_000 })
  })

  test("refuses an estimate above the remaining session budget, before dispatch", async () => {
    await fresh({ sessionBudgetUsd: 0.04 })
    let code: string | undefined
    try {
      shapeInput("search_posts_all", { query: "q", max_results: 10 }, call())
    } catch (error) {
      code = pluginError(error)?.code
    }
    expect(code).toBe("X_BUDGET_EXCEEDED")
  })

  test("an Owned-Read-eligible estimate is refused at the conservative price", async () => {
    await fresh({ sessionBudgetUsd: 0.04 })
    let code: string | undefined
    try {
      shapeInput("get_users_mentions", { id: "1", max_results: 10 }, call())
    } catch (error) {
      code = pluginError(error)?.code
    }
    expect(code).toBe("X_BUDGET_EXCEEDED")
  })

  test("counts a write, and the structured result carries the cost", async () => {
    await fresh()
    shapeInput("create_users_bookmark", { id: "1" }, call())
    const result = shapeResult("create_users_bookmark", { text: "ok" }, call())
    expect(result.text).toBe("ok\nCost: at most 1 request ($0.005) = $0.005.")
    expect((result.output as Record<string, unknown>).cost).toMatchObject({ estimateUsd: 0.005, actualUsd: 0.005, sessionSpentUsd: 0.005, basis: "conservative" })
  })

  test("ownsXApp true uses the Owned Read price and labels the basis owned", async () => {
    await fresh({ ownsXApp: true, sessionBudgetUsd: 1 })
    expect(estimateCall("get_users_mentions", { id: "1", max_results: 10 }).estimateUsd).toBe(0.01)
    shapeInput("get_users_mentions", { id: "1", max_results: 10 }, call())
    const result = shapeResult("get_users_mentions", { output: { data: [{ id: "1" }, { id: "2" }, { id: "3" }] }, text: "" }, call())
    expect(result.text).toBe("Cost: 3 posts ($0.003) = $0.003.")
    expect((result.output as Record<string, unknown>).cost).toMatchObject({ actualUsd: 0.003, basis: "owned" })
    resetBilling()
  })

  // One basis on every path: the model path's own line and the script path's structured cost read the same flag.
  test("the model path and the script path report the same basis for the same ownsXApp", () => {
    const mentions = { output: { data: [{ id: "1" }, { id: "2" }] }, content: [{ type: "text", text: "" }] }
    const scripted = { output: { data: [{ id: "1" }, { id: "2" }] }, text: "" }
    expect(costOf("x_get_users_mentions", mentions, true)).toMatchObject({ basis: "owned", total: 0.002 })
    expect(scriptCostOfCall("get_users_mentions", { id: "1", max_results: 2 }, scripted, estimateCall("get_users_mentions", { id: "1", max_results: 2 }, true), true)).toMatchObject({ basis: "owned", actualUsd: 0.002 })
    expect(costOf("x_get_users_mentions", mentions, false)).toMatchObject({ basis: "conservative", total: 0.01 })
    expect(scriptCostOfCall("get_users_mentions", { id: "1", max_results: 2 }, scripted, estimateCall("get_users_mentions", { id: "1", max_results: 2 }, false), false)).toMatchObject({ basis: "conservative", actualUsd: 0.01 })
  })

  test("an explicit per-call owns flag prices owned even when the configured snapshot is conservative", async () => {
    await fresh({ ownsXApp: false })
    shapeInput("get_users_mentions", { id: "1", max_results: 2 }, call(), true)
    const result = shapeResult("get_users_mentions", { output: { data: [{ id: "1" }, { id: "2" }] }, text: "" }, call(), true)
    expect(result.text).toBe("Cost: 2 posts ($0.002) = $0.002.")
    expect((result.output as Record<string, unknown>).cost).toMatchObject({ basis: "owned", actualUsd: 0.002 })
    resetBilling()
  })

  test("persists across a reload and shares the daily ledger across sessions", async () => {
    const store = await fresh({ sessionBudgetUsd: 1, dailyBudgetUsd: 1 })
    shapeInput("search_posts_all", { query: "q", max_results: 10 }, call("ses_a"))
    shapeResult("search_posts_all", { output: { data: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })) }, text: "" }, call("ses_a"))
    await flushBilling()
    expect(billingStatus().dailySpentUsd).toBe(0.05)

    // A reload: fresh memory, the same storage.
    await configureBilling({ storage: store, sessionBudgetUsd: 1, dailyBudgetUsd: 0.08 })
    expect(billingStatus().dailySpentUsd).toBe(0.05)
    // The same 10-post call fits the new session but not the daily remainder.
    let code: string | undefined
    try {
      shapeInput("search_posts_all", { query: "q", max_results: 10 }, call("ses_b"))
    } catch (error) {
      code = pluginError(error)?.code
    }
    expect(code).toBe("X_BUDGET_EXCEEDED")
  })

  test("rolls the daily window after 24 hours", async () => {
    const store = storage()
    store.data.set("billing.ledger.v1", { entries: [{ at: Date.now() - 25 * 60 * 60 * 1000, usd: 0.5 }, { at: Date.now() - 23 * 60 * 60 * 1000, usd: 0.1 }] })
    await configureBilling({ storage: store, sessionBudgetUsd: 1, dailyBudgetUsd: 1 })
    expect(billingStatus().dailySpentUsd).toBe(0.1)
  })

  test("the model path's own cost counts toward the same daily ledger", async () => {
    await fresh()
    recordModelCost(0.15)
    expect(billingStatus().dailySpentUsd).toBe(0.15)
  })

  test("the actual cost falls back to the estimate when X reports no usage", async () => {
    await fresh()
    const estimate = estimateCall("create_posts", { text: "hello" })
    const cost = scriptCostOfCall("create_posts", { text: "hello" }, { text: "ok" }, estimate)
    expect(cost.actualUsd).toBe(0.015)
    resetBilling()
  })
})
