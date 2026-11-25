// The profile, the MCP server it builds, and the options an installation can get wrong.
import { afterEach, describe, expect, test } from "bun:test"
import { maxCallsOf, serverConfig } from "../../src/accounts.js"
import { manifest } from "../../src/manifest.js"
import { X_ENDPOINT, X_REDIRECT_URI, X_SCOPES } from "../../src/provider/index.js"

const ENV = "X_TEST_CLIENT_SECRET"

afterEach(() => {
  delete process.env[ENV]
})

describe("serverConfig", () => {
  test("a native app is a public client with the pinned callback and scopes", () => {
    expect(serverConfig({ alias: "work", profile: { clientId: "client-1" } })).toEqual({
      type: "remote",
      url: X_ENDPOINT,
      oauth: { client_id: "client-1", redirect_uri: X_REDIRECT_URI, scope: X_SCOPES.join(" ") },
    })
  })

  test("a confidential app names the environment variable, never the secret", () => {
    process.env[ENV] = "secret-1"
    expect(serverConfig({ alias: "work", profile: { clientId: "client-1", clientSecretEnv: ENV, redirectUri: "https://example.test/callback" } })).toMatchObject({
      oauth: { client_id: "client-1", client_secret: "secret-1", redirect_uri: "https://example.test/callback" },
    })
  })

  test("an empty profile is a problem that names the alias and the field, not a server that cannot sign in", () => {
    expect(() => serverConfig({ alias: "personal" })).toThrow(/options\.accounts\.personal\.clientId is missing/)
    expect(() => serverConfig({ alias: "work", profile: { clientId: "client-1", clientSecretEnv: ENV } })).toThrow(new RegExp(`${ENV}, and that environment variable is not set`))
  })
})

describe("maxCallsOf", () => {
  test("defaults to the manifest's 4 and accepts the declared range", () => {
    expect(maxCallsOf(manifest, {})).toBe(4)
    expect(maxCallsOf(manifest, { maxCalls: 2 })).toBe(2)
    expect(maxCallsOf(manifest, { maxCalls: 20 })).toBe(20)
  })

  test("refuses a value outside the range with OPTIONS_INVALID", () => {
    for (const value of [1, 21, 3.5, "4", null]) expect(() => maxCallsOf(manifest, { maxCalls: value })).toThrow(/OPTIONS_INVALID: options\.maxCalls/)
  })
})
