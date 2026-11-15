// The source contract's conformance kit over each source this plugin declares in package.json's `sources`, run on the
// plugin's own events_list and probe methods against recorded X answers (test/fixtures/sources.json, all invented):
// no X call, no sign-in. The reads go through a fake of OpenCode's executor that asserts `x_<tool>` on the kit's
// recording permission, as the host asserts it, so the kit sees exactly what each read asserts. The report is written to
// reports/conformance-report.json, for a release to attach.
import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { declarationProblems, sourceConformance, type ConformanceReport, type PageCase, type SessionContext } from "@we-the-rebel-alliance/source-contract/conformance"
import { readInstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { SOURCES_SCHEMA, type Sources } from "@we-the-rebel-alliance/source-contract/schema"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { eventsMethod, FEEDS, NAMESPACE, PACKAGE, probeMethod, type EventsToolOptions, type Feed } from "../../src/events.js"
import { TOOLS_RPC_ID } from "../../src/tools-rpc.js"
import type { Status } from "../../src/status.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; sources: unknown; jelly: { tools: { name: string; readOnly: boolean }[] } }
/** The declaration as Memory's schema parses it, which is what the kit takes. */
const checked = SOURCES_SCHEMA.check(pkg.sources)
if (!checked.ok) throw new Error(`the sources declaration is invalid: ${checked.problems.join("; ")}`)
const sources: Sources = checked.value
const X = JSON.parse(readFileSync(join(root, "test/fixtures/sources.json"), "utf8")) as Record<string, any>

const NOW = Date.parse("2026-11-08T12:00:00Z")
const SINCE = "2026-11-01T00:00:00Z"
const ACCOUNT = "samrivera"
/** Each feed answers one page at a time from X, so no single post can fail on its own. */
const ATOMIC = "X answers each feed read (get_users_mentions, get_users_timeline, get_users_bookmarks) as one page in one call, so no single post can fail on its own"
const TOOL_FEED: Record<string, Feed> = { x_get_users_mentions: "mentions", x_get_users_timeline: "timeline", x_get_users_bookmarks: "bookmarks" }

const answer = (value: unknown) => ({ output: value, content: [{ type: "text", text: JSON.stringify(value) }] })

/**
 * OpenCode's executors for X's reads, answering as X does from the recorded data: mentions and the timeline newest
 * first, after `since_id` or from `start_time`; bookmarks in their own order, the noted ones only to a first listing
 * (no expansions). Each asserts its own `x_<tool>` on the session's permission first, as the host does.
 */
function executors(permission: SessionContext["permission"], noted = false) {
  const execute = (tool: string, input: Record<string, unknown>) => {
    if (tool === "x_get_users_me") return answer({ data: X["me"] })
    if (tool === "x_get_users_by_username") {
      const me = X["me"] as { username: string }
      return String(input["username"]).toLowerCase() === me.username.toLowerCase() ? answer({ data: me }) : answer({ errors: [{ title: "Not Found Error", detail: "Could not find user." }] })
    }
    const feed = TOOL_FEED[tool]!
    if (input["id"] !== X["me"].id) return answer({ errors: [{ title: "Forbidden", detail: "Not this user." }] })
    let posts: any[] = feed === "bookmarks" ? (noted || input["expansions"] === undefined ? X["bookmarksNoted"] : [...X["bookmarks"], ...X["bookmarksNoted"]]) : [...X[feed]]
    if (feed !== "bookmarks") {
      const since = input["since_id"] === undefined ? undefined : BigInt(String(input["since_id"]))
      const start = input["start_time"] === undefined ? undefined : Date.parse(String(input["start_time"]))
      const until = input["until_id"] === undefined ? undefined : BigInt(String(input["until_id"]))
      posts = posts.filter((item) => (since === undefined || BigInt(item.id) > since) && (start === undefined || Date.parse(item.created_at) >= start) && (until === undefined || BigInt(item.id) < until))
    }
    const page = posts.slice(0, Number(input["max_results"] ?? 100))
    const users = String(input["expansions"] ?? "").includes("author_id") ? X["users"].filter((user: { id: string }) => page.some((item) => item.author_id === user.id)) : []
    return answer({ ...(page.length === 0 ? {} : { data: page, ...(users.length === 0 ? {} : { includes: { users } }) }), meta: { result_count: page.length } })
  }
  return {
    list: async () =>
      ["x_get_users_me", "x_get_users_by_username", ...Object.keys(TOOL_FEED)].map((id) => ({
        id,
        execute: async (input: Record<string, unknown>) => {
          await permission.assert({ action: id, resources: ["*"] })
          return execute(id, input)
        },
      })),
  }
}

const connected = { state: "connected", nextStep: "Nothing to do." } as unknown as Status
const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_script", id: `script:${Math.random()}`, signal: new AbortController().signal, progress: async () => {} })
const options = (context: SessionContext, noted = false): EventsToolOptions => ({
  tool: executors(context.permission, noted) as never,
  permission: context.permission as never,
  feeds: FEEDS,
  maxCalls: 4,
  owned: () => true,
  status: async () => connected,
  now: () => NOW,
})
const open: SessionContext = { account: ACCOUNT, permission: { assert: async () => {} } }
const list = (input: Record<string, unknown>, context: SessionContext = open, noted = false) => eventsMethod(options(context, noted)).run(input, call()) as Promise<Record<string, any>>

/** The cursor a source's first listing answers, against the data a first listing sees. */
const firstCursor = async (feed: Feed) => (await list({ source: feed, account: ACCOUNT, since: SINCE }, open, true))["cursor"] as string

async function casesFor(feed: Feed): Promise<PageCase[]> {
  const first = await firstCursor(feed)
  const done = (await list({ source: feed, cursor: first }))["cursor"] as string
  const other = feed === "mentions" ? "bookmarks" : "mentions"
  return [
    { name: "a first listing, by the account probe names", input: { source: feed, account: ACCOUNT, since: SINCE }, expect: "page" },
    { name: "what came after the first listing, one post refused for a secret", input: { source: feed, cursor: first }, expect: "page" },
    { name: "the same, naming the account", input: { source: feed, account: ACCOUNT, cursor: first, limit: 2 }, expect: "page" },
    { name: "nothing new since the last listing", input: { source: feed, cursor: done }, expect: "empty" },
    { name: "a first listing that names no account", input: { source: feed, since: SINCE }, expect: { refuses: "INPUT_INVALID" } },
    { name: "another account's cursor", input: { source: feed, account: "someoneelse", cursor: first }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "another source's cursor", input: { source: other, cursor: first }, expect: { refuses: "CURSOR_INVALID" } },
    {
      name: "a cursor bound to another plugin",
      input: { source: feed, cursor: encodeBoundCursor({ plugin: "y", source: feed, account: ACCOUNT }, { a: ACCOUNT, i: X["me"].id, l: "Sam Rivera (@SamRivera)", p: { t: NOW } }) },
      expect: { refuses: "CURSOR_INVALID" },
    },
    { name: "a source this plugin does not have", input: { source: "likes", account: ACCOUNT }, expect: { refuses: "SOURCE_UNKNOWN" } },
  ]
}

const reports: ConformanceReport[] = []

describe("the source contract's conformance kit", () => {
  test("the declaration validates, as a consumer reads it from the installed package", () => {
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    expect(installed.ok ? [] : installed.problems).toEqual([])
    const tools = pkg.jelly.tools.map((tool) => ({ id: tool.name.replace(/^x\./, ""), readOnly: tool.readOnly }))
    expect(declarationProblems(pkg.sources, { tools })).toEqual([])
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(pkg.name).toBe(PACKAGE)
    expect(sources.items.map((item) => item.id)).toEqual(FEEDS.map((feed) => `${NAMESPACE}.${feed}`))
  })

  for (const feed of FEEDS) {
    test(`x.${feed} keeps the contract`, async () => {
      const source = sources.items.find((item) => item.id === `${NAMESPACE}.${feed}`)!
      const report = await sourceConformance({
        plugin: PACKAGE,
        source,
        tools: pkg.jelly.tools.map((tool) => ({ id: tool.name.replace(/^x\./, ""), readOnly: tool.readOnly })),
        calls: {
          list: (input, context) => list(input, context),
          probe: (input, context) => probeMethod(options(context)).run(input, call()),
        },
        cases: await casesFor(feed),
        account: ACCOUNT,
        sources,
        describe: { id: TOOLS_RPC_ID },
        atomicPages: { reason: ATOMIC },
      })
      reports.push(report)
      expect(report.problems).toEqual([])
      // X reaches back only a limited number of recent posts in each feed, so a cursor older than that window can miss
      // posts. X gives no sign of it (it moves an old since_id forward silently), so the plugin cannot tell, never
      // answers CURSOR_EXPIRED, and the kit's gap check cannot run: the report stays incomplete on that one check.
      expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual(["gap-and-cursor-expired"])
    })
  }

  test("writes the report a release attaches", () => {
    expect(reports.map((report) => report.source).sort()).toEqual(FEEDS.map((feed) => `${NAMESPACE}.${feed}`).sort())
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    const report = {
      contract: "@we-the-rebel-alliance/source-contract@0.1.0",
      plugin: PACKAGE,
      version: pkg.version,
      descriptorHash: installed.ok ? installed.value.hash : null,
      ok: reports.every((entry) => entry.ok),
      sources: reports,
    }
    mkdirSync(join(root, "reports"), { recursive: true })
    writeFileSync(join(root, "reports", "conformance-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  })
})
