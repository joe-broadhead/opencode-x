// The conformance recording: what the plugin's own handlers answer for two synthetic X accounts.
//
// The kit replays `fixtures/conformance.json`; this test is what produces it, so the recording and the code cannot
// drift. Run `RECORD=1 bun test ./test/conformance` to rewrite it, then `npx plugin-kit record --account work` to
// redact it. Every handle, post and id is invented, and no request leaves the machine.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { accountsOf, resolveAccount } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { decodeBoundCursor, type CursorBinding } from "@we-the-rebel-alliance/plugin-contract/cursor"
import { manifest } from "../../src/manifest.js"
import { FEEDS } from "../../src/provider/index.js"
import { harness } from "../support/handlers.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const fixtureFile = join(root, "fixtures", "conformance.json")
const SINCE = "2026-11-01T00:00:00.000Z"

const recorded = () => JSON.parse(readFileSync(fixtureFile, "utf8")) as Record<string, unknown>

describe("the conformance recording", () => {
  const run = harness()
  const first = (name: string, account = "work") => run.handlers[name]!.run({ source: "mentions", since: SINCE }, run.call(account))

  test("the two-account cases are the contract's", () => {
    const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.accounts.map((account) => account.alias)).toEqual(["work", "personal"])
    expect(resolveAccount(plan.value.accounts, {})).toMatchObject({ ok: false, code: "ACCOUNT_REQUIRED" })
    expect(resolveAccount(plan.value.accounts, { account: "nobodyhere" })).toMatchObject({ ok: false, code: "ACCOUNT_UNKNOWN" })
  })

  test("builds the fixture from the handlers", async () => {
    const sources: Record<string, unknown> = {}
    const cases: Record<string, unknown[]> = { "x.mentions": [], "x.bookmarks": [], "x.timeline": [] }
    for (const feed of FEEDS) {
      cases[`x.${feed}`]!.push({
        input: { source: feed, account: "work", since: SINCE },
        expect: "page",
        answer: await run.handlers.events_list!.run({ source: feed, since: SINCE }, run.call("work")),
      })
    }
    cases["x.mentions"]!.push({
      input: { source: "mentions", account: "personal", since: SINCE },
      expect: "page",
      answer: await first("events_list", "personal"),
    })
    for (const feed of FEEDS) {
      sources[`x.${feed}`] = {
        cases: cases[`x.${feed}`],
        probe: {
          input: { source: feed, account: "work" },
          answer: await run.handlers.probe!.run({ source: feed }, run.call("work")),
        },
      }
    }
    const status = await run.handlers.status!.run({}, run.call("work"))
    const workCursor = (cases["x.mentions"]![0] as { answer: { events: unknown[]; cursor: string } }).answer.cursor
    const binding: CursorBinding = { plugin: "x", source: "mentions", account: "work" }
    expect(decodeBoundCursor(binding, workCursor).ok).toBe(true)

    const fixture = {
      $comment:
        "Recorded from the synthetic X in test/support/fake-x.ts through the plugin's own handlers: two MCP account aliases, the three feeds, a probe per feed, status, and a cursor that another account may not use. Every handle, post and id is invented.",
      plugin: "@we-the-rebel-alliance/x-plugin",
      accounts: {
        real: true,
        aliases: ["work", "personal"],
        required: { method: "events_list", code: "ACCOUNT_REQUIRED" },
        unknown: { method: "events_list", account: "nobodyhere", code: "ACCOUNT_UNKNOWN" },
        cursors: [{ method: "events_list", account: "work", other: "personal", code: "CURSOR_INVALID" }],
      },
      sources,
      events: { status },
      rpc: { inputs: { events_list: { source: "mentions" } } },
      namespace: manifest.plugin.summary,
    }
    if (process.env["RECORD"] === "1") {
      mkdirSync(join(root, "fixtures"), { recursive: true })
      writeFileSync(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`)
    }
    expect(existsSync(fixtureFile)).toBe(true)
    expect(recorded()).toEqual(fixture as unknown as Record<string, unknown>)
  }, 30_000)

  test("a cursor issued to one account is refused by the other", async () => {
    const page = (await first("events_list", "work")) as { cursor: string }
    const crossed = await run.handlers.events_list!.run({ source: "mentions", cursor: page.cursor, since: SINCE }, run.call("personal")).catch((error: unknown) => error)
    expect(crossed).toMatchObject({ refusal: { code: "CURSOR_INVALID" } })
  })

  test("the fixture names the installed version and both aliases", () => {
    const fixture = recorded() as { events: { status: { version: string; accounts: { alias: string }[] } } }
    expect(fixture.events.status.version).toBe("0.0.0")
    expect(fixture.events.status.accounts.map((account) => account.alias)).toEqual(["work", "personal"])
  })
})
