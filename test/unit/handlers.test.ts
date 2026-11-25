// The plugin's own handlers against the synthetic X: the three feeds, the cursor's account binding, the probe, and
// status with a refused credential and with an agent list that cannot be read.
import { describe, expect, test } from "bun:test"
import { harness } from "../support/handlers.js"

const SINCE = "2026-11-01T00:00:00.000Z"

describe("events_list", () => {
  test("lists mentions oldest first with both billed units", async () => {
    const { handlers, call } = harness()
    const page = (await handlers.events_list!.run({ source: "mentions", since: SINCE }, call("work"))) as {
      source: string
      account: string
      owner: { id: string; label: string }
      events: { external_id: string; kind: string; title: string; url: string; hash: string }[]
      more: boolean
      trust: string
      cost: { units: { per: string; count: number }[] }
    }
    expect(page.source).toBe("mentions")
    expect(page.account).toBe("work")
    expect(page.owner).toEqual({ id: "x:@anawork", label: "@AnaWork" })
    expect(page.events.map((event) => event.external_id)).toEqual(["9001", "9002"])
    expect(page.events[0]!.kind).toBe("message")
    expect(page.events[0]!.url).toBe("https://x.com/i/status/9001")
    expect(page.trust).toBe("untrusted")
    expect(page.more).toBe(false)
    expect(page.cost.units).toEqual([
      { per: "post", count: 2 },
      { per: "author", count: 2 },
      { per: "user", count: 1 },
    ])
  })

  test("lists bookmarks with the bookmark unit and the first-listing start", async () => {
    const { handlers, call } = harness()
    const page = (await handlers.events_list!.run({ source: "bookmarks", since: SINCE }, call("work"))) as {
      events: { external_id: string; kind: string; labels: string[] }[]
      cost: { units: { per: string; count: number }[] }
    }
    expect(page.events.map((event) => event.external_id)).toEqual(["bookmark:9101"])
    expect(page.events[0]!.kind).toBe("bookmark")
    expect(page.events[0]!.labels).toEqual(["bookmark"])
    expect(page.cost.units).toEqual([
      { per: "post", count: 1 },
      { per: "author", count: 1 },
      { per: "user", count: 1 },
    ])
  })

  test("the personal account reads its own page", async () => {
    const { handlers, call } = harness()
    const page = (await handlers.events_list!.run({ source: "timeline", since: SINCE }, call("personal"))) as {
      account: string
      owner: { id: string }
      events: { external_id: string }[]
    }
    expect(page.account).toBe("personal")
    expect(page.owner.id).toBe("x:@anapersonal")
    expect(page.events.map((event) => event.external_id)).toEqual(["9501"])
  })

  test("refuses a cursor issued to another account", async () => {
    const { handlers, call } = harness()
    const page = (await handlers.events_list!.run({ source: "mentions", since: SINCE }, call("work"))) as { cursor: string }
    const crossed = await handlers.events_list!.run({ source: "mentions", cursor: page.cursor }, call("personal")).catch((error: unknown) => error)
    expect(crossed).toMatchObject({ refusal: { code: "CURSOR_INVALID" } })
    expect((crossed as { message: string }).message).toContain("Next step: ")
  })

  test("refuses a source it does not serve", async () => {
    const { handlers, call } = harness()
    const refused = await handlers.events_list!.run({ source: "messages" }, call("work")).catch((error: unknown) => error)
    expect(refused).toMatchObject({ refusal: { code: "SOURCE_UNKNOWN" } })
  })

  test("a cursor from one feed is refused by another", async () => {
    const { handlers, call } = harness()
    const page = (await handlers.events_list!.run({ source: "mentions", since: SINCE }, call("work"))) as { cursor: string }
    const refused = await handlers.events_list!.run({ source: "bookmarks", cursor: page.cursor }, call("work")).catch((error: unknown) => error)
    expect(refused).toMatchObject({ refusal: { code: "CURSOR_INVALID" } })
  })
})

describe("probe", () => {
  test("reads the owner with one billed user read and no content", async () => {
    const { handlers, fake, call } = harness()
    const before = fake.calls.length
    const answer = (await handlers.probe!.run({ source: "mentions" }, call("work"))) as {
      source: string
      account: string
      owner: { id: string; label: string }
      cost: { units: { per: string; count: number }[] }
      trust: string
    }
    expect(answer).toEqual({
      source: "mentions",
      account: "work",
      owner: { id: "x:@anawork", label: "@AnaWork" },
      cost: { units: [{ per: "user", count: 1 }] },
      trust: "untrusted",
    })
    expect(fake.calls.slice(before)).toEqual([{ account: "work", tool: "get_users_me", input: {} }])
  })

  test("answers the source it was asked about", async () => {
    const { handlers, call } = harness()
    const answer = (await handlers.probe!.run({ source: "timeline" }, call("personal"))) as { source: string; account: string }
    expect(answer.source).toBe("timeline")
    expect(answer.account).toBe("personal")
  })
})

describe("status", () => {
  test("lists both aliases with their owners and no X read", async () => {
    const { handlers, fake, call } = harness()
    for (const account of ["work", "personal"]) await handlers.probe!.run({}, call(account))
    const before = fake.calls.length
    const answer = (await handlers.status!.run({}, call())) as {
      name: string
      version: string
      host: { version: string; range: string; tested: string[] }
      state: string
      accounts: { alias: string; state: string; owner?: { id: string } }[]
      unguardedAgents: string[]
      nextStep: string | null
    }
    expect(fake.calls.length).toBe(before)
    expect(answer.name).toBe("x")
    expect(answer.version).toBe("0.0.0")
    expect(answer.host).toEqual({ version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
    expect(answer.state).toBe("ready")
    expect(answer.accounts.map((account) => [account.alias, account.state, account.owner?.id])).toEqual([
      ["work", "ready", "x:@anawork"],
      ["personal", "ready", "x:@anapersonal"],
    ])
    expect(answer.unguardedAgents).toEqual([])
    expect(answer.nextStep).toBeNull()
  })

  test("a refused token refresh is needs_sign_in with a redacted reason", async () => {
    const { handlers, fake, call } = harness()
    // An invented JWT for this test only: the refusal carries it so the status can prove it is redacted.
    const refusedJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcdefghijklmnop"].join(".")
    fake.setServers([
      { name: "x", status: "connected" },
      { name: "x-work", status: "needs_auth", error: `the refresh token ${refusedJwt} was refused` },
      { name: "x-personal", status: "connected" },
    ])
    const answer = (await handlers.status!.run({}, call())) as { state: string; accounts: { alias: string; state: string; reason?: string }[]; nextStep: string | null }
    expect(answer.state).toBe("needs_sign_in")
    expect(answer.accounts[0]).toMatchObject({ alias: "work", state: "needs_sign_in" })
    expect(answer.accounts[1]).toMatchObject({ alias: "personal", state: "ready" })
    expect(answer.accounts[0]!.reason).toBeDefined()
    expect(answer.accounts[0]!.reason).not.toContain("eyJhbGciOiJIUzI1NiJ9")
    expect(answer.nextStep).toContain("Sign in to the account that needs it")
  })

  test("a failed provider read is a needs_sign_in or error state until a read succeeds", async () => {
    const { handlers, fake, observations, call } = harness()
    fake.setServers([
      { name: "x", status: "connected" },
      { name: "x-work", status: "connected" },
      { name: "x-personal", status: "connected" },
    ])
    observations.setFailure("work", "needs_sign_in", "the credential was refused")
    expect(((await handlers.status!.run({}, call())) as { accounts: { state: string }[] }).accounts[0]!.state).toBe("needs_sign_in")
    await handlers.probe!.run({}, call("work"))
    expect(((await handlers.status!.run({}, call())) as { accounts: { state: string }[] }).accounts[0]!.state).toBe("ready")
  })

  test("an error problem makes status error but never invents agents", async () => {
    const { handlers, call } = harness()
    const answer = (await handlers.status!.run({}, call("work", { unguardedAgents: async () => ({ ok: false as const, error: "the agent list could not be read" }) }))) as {
      state: string
      unguardedAgents: string[]
      nextStep: string | null
    }
    expect(answer.state).toBe("error")
    expect(answer.unguardedAgents).toEqual([])
    expect(answer.nextStep).toBe("the agent list could not be read")
  })
})
