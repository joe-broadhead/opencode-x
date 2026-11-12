import { describe, expect, test } from "bun:test"
import { REDIRECT_URI, SCOPES } from "../../src/constants.js"
import type { Feed } from "../../src/events.js"
import { parseOptions } from "../../src/options.js"

const defaults = { redirectUri: REDIRECT_URI, scopes: [...SCOPES], allowUntestedHost: false, access: "all" as const, ownsXApp: false, feeds: ["mentions", "bookmarks"] as Feed[], maxCalls: 4 }

describe("parseOptions", () => {
  test("defaults to the pinned callback and scopes, a tested host, and no client", () => {
    expect(parseOptions(undefined)).toEqual({ ok: true, options: defaults })
    expect(parseOptions({})).toEqual({ ok: true, options: defaults })
    expect(parseOptions({ scriptBudgetUsd: 2.5 })).toMatchObject({ ok: true, options: { scriptBudgetUsd: 2.5 } })
    expect(parseOptions({ scriptDailyBudgetUsd: 5 })).toMatchObject({ ok: true, options: { scriptDailyBudgetUsd: 5 } })
    // Both script budgets are opt-in: unset or null is no budget, and a large number is the user's choice.
    expect(parseOptions({})).toMatchObject({ ok: true, options: expect.not.objectContaining({ scriptBudgetUsd: expect.anything() }) })
    expect(parseOptions({ scriptBudgetUsd: null, scriptDailyBudgetUsd: null })).toEqual({ ok: true, options: defaults })
    expect(parseOptions({ scriptBudgetUsd: 5_000, scriptDailyBudgetUsd: 25_000 })).toMatchObject({ ok: true, options: { scriptBudgetUsd: 5_000, scriptDailyBudgetUsd: 25_000 } })
    expect(parseOptions({ access: "ask-changes" })).toMatchObject({ ok: true, options: { access: "ask-changes" } })
    expect(parseOptions({ ownsXApp: true })).toMatchObject({ ok: true, options: { ownsXApp: true } })
    expect(REDIRECT_URI).toBe("http://127.0.0.1:8766/callback")
    expect(SCOPES).toContain("offline.access")
  })

  test("accepts the documented oauth options", () => {
    expect(parseOptions({ oauth: { client_id: "client-1", client_secret: "secret-1" } })).toEqual({
      ok: true,
      options: { ...defaults, clientId: "client-1", clientSecret: "secret-1" },
    })
    expect(parseOptions({ oauth: { redirect_uri: "http://localhost:8766/callback", scopes: ["tweet.read"] }, allowUntestedHost: true })).toEqual({
      ok: true,
      options: { redirectUri: "http://localhost:8766/callback", scopes: ["tweet.read"], allowUntestedHost: true, access: "all" as const, ownsXApp: false, feeds: ["mentions", "bookmarks"] as Feed[], maxCalls: 4 },
    })
    // The home timeline is collected only when the person names it; the call cap is theirs to raise.
    expect(parseOptions({ events: { feeds: ["timeline", "mentions"], maxCalls: 10 } })).toEqual({ ok: true, options: { ...defaults, feeds: ["timeline", "mentions"], maxCalls: 10 } })
    // No ceiling: a large call cap is the user's choice.
    expect(parseOptions({ events: { maxCalls: 500 } })).toMatchObject({ ok: true, options: { maxCalls: 500 } })
    expect(parseOptions({ oauth: { redirect_uri: "https://example.com/callback", callback_port: 8767 } })).toMatchObject({ ok: true, options: { callbackPort: 8767 } })
  })

  test.each([
    [{ apiKey: "sk-fake-000" }, "apiKey", "This option is not supported."],
    [{ oauth: { bogus: 1 } }, "oauth.bogus", "This option is not supported."],
    [{ oauth: [] }, "oauth", "Must be an object."],
    [{ oauth: { client_id: "" } }, "oauth.client_id", "Must be a non-empty string without spaces."],
    [{ oauth: { client_id: "has space" } }, "oauth.client_id", "Must be a non-empty string without spaces."],
    [{ oauth: { redirect_uri: "http://example.com/callback" } }, "oauth.redirect_uri", "An http: URL must use the host localhost or 127.0.0.1."],
    [{ oauth: { redirect_uri: "http://127.0.0.1/callback" } }, "oauth.redirect_uri", "An http: URL must include an explicit port."],
    [{ oauth: { redirect_uri: "http://127.0.0.1:8766/" } }, "oauth.redirect_uri", "Must include a path, such as /callback."],
    [{ oauth: { redirect_uri: "http://127.0.0.1:8766/callback?x=1" } }, "oauth.redirect_uri", "Must not include a query or fragment."],
    [{ oauth: { callback_port: 8767 } }, "oauth.callback_port", "Applies only to an https: oauth.redirect_uri."],
    [{ oauth: { redirect_uri: "https://example.com/callback" } }, "oauth.callback_port", "Must be set with an https: oauth.redirect_uri."],
    [{ oauth: { callback_port: 0 } }, "oauth.callback_port", "Must be a whole number from 1 to 65535."],
    [{ oauth: { scopes: [] } }, "oauth.scopes", "Must be a non-empty list of scope names without spaces."],
    [{ oauth: { scopes: ["tweet read"] } }, "oauth.scopes", "Must be a non-empty list of scope names without spaces."],
    [{ oauth: { scopes: ["tweet.read", "tweet.read"] } }, "oauth.scopes", "Lists a scope more than once."],
    [{ oauth: { client_secret: "" } }, "oauth.client_secret", "Must be a non-empty string."],
    [{ oauth: { client_secret: "secret-1" } }, "oauth.client_secret", "Needs oauth.client_id."],
    [{ allowUntestedHost: "yes" }, "allowUntestedHost", "Must be true or false."],
    [{ scriptBudgetUsd: "1.00" }, "scriptBudgetUsd", "Must be a number greater than 0, or unset for no budget."],
    [{ scriptBudgetUsd: 0 }, "scriptBudgetUsd", "Must be a number greater than 0, or unset for no budget."],
    [{ scriptBudgetUsd: -1 }, "scriptBudgetUsd", "Must be a number greater than 0, or unset for no budget."],
    [{ scriptBudgetUsd: Number.POSITIVE_INFINITY }, "scriptBudgetUsd", "Must be a number greater than 0, or unset for no budget."],
    [{ scriptDailyBudgetUsd: "1.00" }, "scriptDailyBudgetUsd", "Must be a number greater than 0, or unset for no cap."],
    [{ scriptDailyBudgetUsd: 0 }, "scriptDailyBudgetUsd", "Must be a number greater than 0, or unset for no cap."],
    [{ scriptDailyBudgetUsd: -5 }, "scriptDailyBudgetUsd", "Must be a number greater than 0, or unset for no cap."],
    [{ ownsXApp: "yes" }, "ownsXApp", "Must be true or false."],
    [{ events: [] }, "events", "Must be an object."],
    [{ events: { since: "x" } }, "events.since", "This option is not supported."],
    [{ events: { feeds: [] } }, "events.feeds", "Must be a non-empty list of mentions, bookmarks, timeline."],
    [{ events: { feeds: ["likes"] } }, "events.feeds", "Must be a non-empty list of mentions, bookmarks, timeline."],
    [{ events: { feeds: ["mentions", "mentions"] } }, "events.feeds", "Lists a feed more than once."],
    [{ events: { maxCalls: 1 } }, "events.maxCalls", "Must be a whole number of at least 2."],
    [{ events: { maxCalls: 2.5 } }, "events.maxCalls", "Must be a whole number of at least 2."],
  ])("rejects %j with the field, the message and a next step", (input, field, message) => {
    const parsed = parseOptions(input)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toMatchObject({ code: "OPTIONS_INVALID", field, message })
    expect(parsed.error.next.endsWith(".")).toBe(true)
    // Never echo a value the user typed.
    expect(JSON.stringify(parsed.error)).not.toContain("sk-fake-000")
    expect(JSON.stringify(parsed.error)).not.toContain("has space")
  })

  test("rejects options that are not an object", () => {
    for (const input of ["read", []]) {
      const parsed = parseOptions(input)
      expect(parsed).toMatchObject({ ok: false, error: { code: "OPTIONS_INVALID", field: "options" } })
    }
  })
})
