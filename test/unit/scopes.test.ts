// The scopes X granted a sign-in, as OpenCode stores them with the credential, against the ones the plugin asks for.
import { describe, expect, test } from "bun:test"
import { SCOPES } from "../../src/constants.js"
import { grantedScopes, missingScopes, readGranted, scopesAgain } from "../../src/scopes.js"

const OLD = SCOPES.filter((scope) => scope !== "media.write")
const credential = (scope: unknown) => ({ type: "oauth", methodID: "m", access: "secret-access", refresh: "secret-refresh", expires: 0, metadata: { serverUrl: "https://api.x.com/mcp", tokenType: "bearer", scope } })

describe("granted scopes", () => {
  test("the default sign-in asks for media.write, which media_upload needs", () => {
    expect(SCOPES).toContain("media.write")
  })

  test("reads only the stored scope string, split on whitespace", () => {
    expect(grantedScopes(credential("tweet.read  users.read\nmedia.write"))).toEqual(["tweet.read", "users.read", "media.write"])
    for (const unknown of [undefined, null, "key", { type: "key", key: "k" }, credential(undefined), credential(""), credential(["tweet.read"]), { metadata: "scope" }]) {
      expect(grantedScopes(unknown)).toBeUndefined()
    }
  })

  test("a sign-in from before this version lacks media.write; an unknown grant claims nothing", () => {
    expect(missingScopes(SCOPES, grantedScopes(credential(OLD.join(" "))))).toEqual(["media.write"])
    expect(missingScopes(SCOPES, grantedScopes(credential(SCOPES.join(" "))))).toEqual([])
    expect(missingScopes(SCOPES, undefined)).toEqual([])
  })

  test("a resolve that fails or is missing reads as unknown", async () => {
    expect(await readGranted(async () => credential(OLD.join(" ")), "c1")).toEqual(OLD)
    expect(await readGranted(async () => Promise.reject(new Error("locked")), "c1")).toBeUndefined()
    expect(await readGranted(() => { throw new TypeError("not a function") }, "c1")).toBeUndefined()
  })

  test("the /connect mark names the missing scope and the step, and no token", () => {
    expect(scopesAgain(["media.write"])).toBe("X's sign-in lacks the scopes this version asks for: media.write. Choose this account to sign in again.")
  })
})
