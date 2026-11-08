import { describe, expect, test } from "bun:test"
import { REDIRECT_URI, SCOPES } from "../../src/constants.js"
import { checkHost } from "../../src/host-version.js"
import { parseOptions } from "../../src/options.js"
import { defaultRules } from "../../src/permissions.js"
import { buildStatus, formatStatus, readStatus, registerStatusCommand, registerStatusRpc, shortReason, StatusRpc, type Status, type StatusContext, type StatusFacts } from "../../src/status.js"
import { VERSION } from "../../src/version.js"
import { PUBLIC_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"
import { allow } from "./fake.js"

const SIGN_IN = "Run `/connect` and choose X, then press `o` or Enter to open the link (in a terminal, `opencode mcp auth x` opens it automatically)."
const NOTHING_TO_DO = "Nothing to do."
const NO_TOOLS =
  `X lists no tools for this app. Check that the app is in Pay-per-use, Production at console.x.com, that it has the OAuth 2.0 scopes ${SCOPES.join(" ")}, then sign in again.`
/** The default rules as /x-status shows them: one rule a line, a JSON array body. */
const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
const parsed = (oauth: Record<string, unknown> = { client_id: "client-1" }) => {
  const result = parseOptions({ oauth })
  if (!result.ok) throw new Error(result.error.message)
  return result.options
}

const host = checkHost("2.2.3", false)
const URL = "https://api.x.com/mcp"
const OPTS = parsed()
const CLIENT = { client: { id: "client-1", source: "options" as const }, invalid: false }
const base: StatusFacts = { server: { status: "connected" }, source: { type: "plugin", url: URL, signIn: "oauth" }, host, client: CLIENT, options: OPTS, tools: ["search_posts_all"] }
const guarded = { id: "build", permissions: [allow("*"), ...defaultRules()] }
const RULES = "no agent runs new X tools unasked"
const POSTURE = "reads run without asking; 9 tools ask first (bookmarks, lists, an Article draft and a public Post); 40 are off (DMs and private chat conversations, calls, follows, blocks, mutes, list membership, moderators and live video); X bills every tool call to the X developer account that owns the app"
const ACCESS = `${POSTURE}; ${RULES}`

describe("buildStatus", () => {
  test("connected, with the client, the pinned callback and scopes, and nothing left to do", () => {
    const status = buildStatus({ ...base, account: "Example account" })
    expect(status).toEqual({
      version: VERSION,
      state: "connected",
      source: { type: "plugin", url: URL, signIn: "oauth" },
      account: "Example account",
      client: { id: "client-1", mode: "public_pkce", source: "options" },
      callback: REDIRECT_URI,
      scopes: [...SCOPES],
      tools: 1,
      deniedTools: [],
      deniedCount: 0,
      listing: false,
      unknownCount: 0,
      unknownTools: [],
      unguardedAgents: [],
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      problems: [],
      nextStep: "Nothing to do.",
    })
    expect(formatStatus(status)).toBe(
      [
        "X status",
        `- Connection: connected (${URL}, registered by this plugin)`,
        "- Account: Example account",
        `- Access: ${ACCESS}`,
        `- Server: x at ${URL}`,
        "- Client: client-1 (configured app, public; set in plugin options)",
        `- Callback: ${REDIRECT_URI} (register exactly this URL in the app's User authentication settings)`,
        `- Scopes: ${SCOPES.join(" ")}`,
        "- Tools: 1 available, 0 unknown",
        "- Agents without default rules: none",
        "- OpenCode: 2.2.3 (tested; supported range >=2.2.3 <2.3.0)",
        "- Next step: Nothing to do.",
      ].join("\n"),
    )
  })

  test("shows the rolling 24-hour script spend against the daily cap, and the per-session cap", () => {
    const status = buildStatus({ ...base, billing: { dailySpentUsd: 0.25, dailyBudgetUsd: 1, sessionBudgetUsd: 0.8 } })
    expect(formatStatus(status)).toContain("- Scripts: $0.25 of $1.00 in the last 24 hours; $0.80 per session")
  })

  test("without a sign-in label, the Account row says X's MCP reports no account name, and the RPC has no account", () => {
    const status = buildStatus(base)
    expect(status).not.toHaveProperty("account")
    const text = formatStatus(status)
    expect(text).toContain("- Account: account name not reported by X's MCP\n")
    expect(text).not.toContain("Plan")
    expect(buildStatus({ ...base, account: " \n " })).not.toHaveProperty("account")
  })

  test("a confidential app shows that a secret is set, never the secret", () => {
    const status = buildStatus({ ...base, client: { client: { id: "client-1", secret: "secret-1", source: "connect" }, invalid: false }, options: parsed({ client_id: "client-1", client_secret: "secret-1" }) })
    expect(status.client).toEqual({ id: "client-1", mode: "confidential", source: "connect" })
    for (const text of [formatStatus(status), JSON.stringify(status)]) expect(text).not.toContain("secret-1")
    expect(formatStatus(status)).toContain("- Client: client-1 (your own app, confidential; saved in /connect)")
  })

  test("the Client row names the kind of app and its source, never a secret", () => {
    const own = buildStatus({ ...base, client: { client: { id: "client-1", source: "connect" }, invalid: false }, options: parsed({ client_id: "client-1" }) })
    expect(formatStatus(own)).toContain("- Client: client-1 (your own app, public; saved in /connect)")
    const ownSecret = buildStatus({ ...base, client: { client: { id: "client-1", secret: "secret-1", source: "connect" }, invalid: false }, options: parsed({ client_id: "client-1", client_secret: "secret-1" }) })
    expect(formatStatus(ownSecret)).toContain("- Client: client-1 (your own app, confidential; saved in /connect)")
    expect(JSON.stringify(ownSecret)).not.toContain("secret-1")
    expect(formatStatus(buildStatus(base))).toContain("- Client: client-1 (configured app, public; set in plugin options)")
  })

  test.each([
    [{ status: "needs_auth", error: "Authorization required" }, "sign_in_required", "sign-in required", SIGN_IN],
    [{ status: "failed", error: "fetch failed" }, "failed", "failed", "Check your network, then run /x-status again."],
    [{ status: "disabled" }, "disabled", "disabled", `The x MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.x in opencode.json.`],
    [{ status: "pending" }, "connecting", "connecting", "X is still connecting. Run /x-status again in a few seconds."],
    [undefined, "not_configured", "not configured", "OpenCode has no x MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode."],
  ] as const)("%j is %s with the exact label and next step", (server, state, label, nextStep) => {
    const status = buildStatus({ ...base, ...(server ? { server } : { server: undefined }) })
    expect(status.state).toBe(state)
    expect(status.nextStep).toBe(nextStep)
    expect(formatStatus(status)).toContain(`- Connection: ${label}`)
    expect(formatStatus(status)).toContain(`- Next step: ${nextStep}`)
  })

  test("shows a failure's reason on one short line, without URL queries, and never the text of a needed sign-in", () => {
    const failed = buildStatus({ ...base, server: { status: "failed", error: "SSE error:\n  fetch https://api.x.com/mcp?token=secret-123 failed.\n" } })
    expect(failed.error).toBe("SSE error: fetch https://api.x.com/mcp failed")
    expect(formatStatus(failed)).toContain(`- Connection: failed (SSE error: fetch https://api.x.com/mcp failed; ${URL}, registered by this plugin)`)
    expect(shortReason("word ".repeat(100))).toHaveLength(160)
    expect(shortReason(" \n. ")).toBeUndefined()
    const signIn = buildStatus({ ...base, server: { status: "needs_auth", error: "Visit https://x.com/i/oauth2/authorize?code=abc to sign in" } })
    expect(signIn.error).toBeUndefined()
    expect(formatStatus(signIn)).not.toContain("authorize")
  })

  test("adopted and conflicting servers", () => {
    const adopted = buildStatus({ ...base, source: { type: "adopted", url: URL, signIn: "oauth" } })
    expect(formatStatus(adopted)).toContain(`- Connection: connected (${URL}, your own mcp.servers.x, used unchanged)`)
    // The user's entry is used unchanged, so its client and callback are not the plugin's to report.
    expect(adopted).not.toHaveProperty("client")
    expect(adopted).not.toHaveProperty("callback")
    expect(formatStatus(adopted)).not.toContain("- Client:")
    const conflict = buildStatus({ ...base, source: { type: "conflict", url: "https://x.example.com/mcp", expected: URL } })
    expect(conflict.state).toBe("conflict")
    expect(conflict.nextStep).toBe(
      `Your OpenCode config defines mcp.servers.x with https://x.example.com/mcp, but the plugin uses ${URL}. Point it at ${URL} or remove it, then restart OpenCode.`,
    )
    expect(formatStatus(conflict)).toContain("- Connection: conflict (your mcp.servers.x points at https://x.example.com/mcp)")
  })

  test("the user's own entry without OAuth is named as such, and its failure says X signs in only with OAuth", () => {
    const own = { type: "adopted", url: URL, signIn: "own" } as const
    expect(formatStatus(buildStatus({ ...base, source: own }))).toContain(`- Connection: connected (${URL}, your own mcp.servers.x without OAuth, used unchanged)`)
    expect(buildStatus({ ...base, source: own, server: { status: "failed", error: "HTTP 401" } }).nextStep).toBe(
      'X\'s server signs in only with OAuth: remove "oauth": false from your own mcp.servers.x in opencode.json, then restart OpenCode and sign in.',
    )
  })

  test("a missing or unusable X app client is a setup state with its code and next step", () => {
    const missing = buildStatus({ host })
    expect(missing).toMatchObject({ state: "not_configured", code: "CLIENT_ID_MISSING", message: "No X app client ID is set, so x is not added.", nextStep: "Run /connect and choose X app, and paste your X app's client ID." })
    expect(formatStatus(missing)).toContain("- Connection: not configured. CLIENT_ID_MISSING: No X app client ID is set, so x is not added.")
    const invalid = buildStatus({ host, client: { invalid: true } })
    expect(invalid).toMatchObject({ code: "CLIENT_ID_INVALID", nextStep: "Run /connect and choose X app, and paste your X app's client ID." })
    expect(invalid.message).toContain("empty or has spaces")
  })

  test("invalid options and an untested host keep their own next steps", () => {
    const setup = { code: "OPTIONS_INVALID" as const, message: 'Option apiKey: This option is not supported.', nextStep: "Remove it. Supported options: oauth, allowUntestedHost." }
    const status = buildStatus({ host, setup })
    expect(status).toMatchObject({ state: "not_configured", code: "OPTIONS_INVALID", message: setup.message, nextStep: setup.nextStep })
    expect(formatStatus(status)).toContain('- Connection: not configured. OPTIONS_INVALID: Option apiKey: This option is not supported.')
    const untested = { code: "HOST_UNTESTED" as const, message: "OpenCode 2.3.0 is outside the supported range, so X is not set up.", nextStep: 'Use OpenCode >=2.2.3 <2.3.0, or set "allowUntestedHost": true in this plugin\'s options to run anyway.' }
    expect(buildStatus({ host: checkHost("2.3.0", true), setup: untested })).toMatchObject({ state: "host_untested", code: "HOST_UNTESTED", nextStep: untested.nextStep })
    expect(formatStatus(buildStatus({ host: checkHost("2.3.0", true), setup: untested }))).toContain("- Connection: host untested")
  })

  test("connected with no tools points at the app's package, Production environment and scopes", () => {
    expect(buildStatus({ ...base, tools: [], agents: [{ id: "reviewer", permissions: [allow("*")] }] }).nextStep).toBe(NO_TOOLS)
  })

  test("counts the available tools, names the unknown ones, and counts denied ones apart; missing known tools are normal", () => {
    const status = buildStatus({ ...base, tools: ["search_posts_all", "create_users_bookmark", "shiny_new_tool", "schedule_post"] })
    expect(status.tools).toBe(4)
    expect(status.deniedTools).toEqual([])
    expect(status.unknownCount).toBe(2)
    expect(status.unknownTools).toEqual(["shiny_new_tool", "schedule_post"])
    expect(formatStatus(status)).toContain("- Tools: 4 available, 2 unknown: shiny_new_tool, schedule_post (unknown tools ask before running)\n")
    expect(status.nextStep).toBe(NOTHING_TO_DO)
  })

  test("a server that just connected and lists no tools yet is still listing them, with no setup advice", () => {
    const listing = buildStatus({ ...base, tools: [], settling: true })
    expect(listing).toMatchObject({ state: "connected", tools: 0, listing: true, nextStep: "X is still listing its tools. Run /x-status again in a few seconds." })
    const text = formatStatus(listing)
    expect(text).toContain(`- Connection: connected (${URL}, registered by this plugin; still listing its tools)`)
    expect(text).toContain("- Tools: none listed yet (X is still listing them)")
    expect(text).not.toContain("Pay-per-use")
    expect(buildStatus({ ...base, tools: [], settling: false }).nextStep).toBe(NO_TOOLS)
    expect(buildStatus({ ...base, tools: [], settling: true, server: { status: "pending" } })).toMatchObject({ listing: false, state: "connecting" })
  })

  test("the Access row says whether the default rules are in place, from what status can see", () => {
    expect(formatStatus(buildStatus(base))).toContain(`- Access: ${ACCESS}\n`)
    expect(ACCESS).toContain("9 tools ask first (bookmarks, lists, an Article draft and a public Post)")
    expect(ACCESS).toContain("40 are off (DMs and private chat conversations, calls, follows, blocks, mutes, list membership, moderators and live video)")
    const missing = buildStatus({ ...base, agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(formatStatus(missing)).toContain(`- Access: ${POSTURE}; default rules missing in the agents listed below\n`)
    const problem = "RULES_NOT_ADDED: X's default permission rules could not be added (boom), so X tools may run without asking. Next step: Restart OpenCode."
    expect(formatStatus(buildStatus({ ...base, problems: [problem] }))).toContain(`- Access: ${POSTURE}; default rules not added (see the OpenCode row)\n`)
  })

  test("a failure's reason never carries a token or key the host's text echoed", () => {
    const failed = buildStatus({ ...base, server: { status: "failed", error: "HTTP 401 for Authorization: Bearer sk-fake-abcdef123456 and api_key=fake-key-000111" } })
    expect(failed.error).toBeDefined()
    expect(failed.error).not.toMatch(/sk-fake|abcdef123456|fake-key-000111/)
  })

  test("names at most 20 unknown tools, and only plain names, but counts them all", () => {
    const odd = ["Bad Name", "x".repeat(70), "evil\u001b[31m", "-dash"]
    const many = Array.from({ length: 25 }, (_, index) => `new_tool_${index}`)
    const status = buildStatus({ ...base, tools: ["search_posts_all", ...odd, ...many] })
    expect(status.unknownCount).toBe(29)
    expect(status.unknownTools).toEqual(many.slice(0, 20))
    expect(formatStatus(status)).toContain(`- Tools: 30 available, 29 unknown: ${many.slice(0, 20).join(", ")} and 9 more (unknown tools ask before running)`)
    expect(formatStatus(buildStatus({ ...base, tools: odd }))).toContain("- Tools: 4 available, 4 unknown (unknown tools ask before running)")
    // A future tool the owner ruled out is counted as off, not as available or unknown.
    const future = buildStatus({ ...base, tools: ["search_posts_all", "create_dm", "delete_post"] })
    expect(future).toMatchObject({ tools: 1, deniedTools: ["create_dm", "delete_post"], deniedCount: 2, unknownCount: 0 })
    expect(formatStatus(future)).toContain("- Tools: 1 available, 0 unknown; off by default: create_dm and delete_post\n")
  })

  test("names agents without the default rules, with the block to paste, and points the next step at it", () => {
    const status = buildStatus({ ...base, agents: [guarded, { id: "reviewer", permissions: [allow("*")] }] })
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.nextStep).toBe(
      "Put the default rules shown by /x-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for X tools.",
    )
    expect(JSON.parse(`[${AGENT_RULES}]`)).toEqual(defaultRules())
    expect(formatStatus(status)).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n- OpenCode:`)
  })

  test("an agent whose own rules already ask or deny for every X tool is not listed", () => {
    const agents = [
      { id: "asks-everything", permissions: [allow("*"), { action: "*", resource: "*", effect: "ask" as const }] },
      { id: "denies-x", permissions: [allow("*"), { action: "x_*", resource: "*", effect: "deny" as const }] },
      { id: "reviewer", permissions: [allow("*")] },
    ]
    expect(buildStatus({ ...base, agents }).unguardedAgents).toEqual(["reviewer"])
  })

  test("the sign-in step comes before the agent fix, which still shows, and there is one next step", () => {
    const status = buildStatus({ ...base, server: { status: "needs_auth", error: "x" }, agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(status.nextStep).toBe(SIGN_IN)
    const text = formatStatus(status)
    expect(text).toContain(`- Connection: sign-in required (${URL}, registered by this plugin)`)
    expect(text).toContain("- Agents without default rules: reviewer\n")
    expect(text.match(/Next step/g)).toHaveLength(1)
  })

  test("denied tool names are stripped of controls, kept plain, and capped, while the count stays exact", () => {
    const status = buildStatus({ ...base, tools: ["search_posts_all", "send_chat_\u001b[31mred", "users_id_block"] })
    expect(status).toMatchObject({ tools: 1, deniedCount: 2, deniedTools: ["users_id_block"], unknownCount: 0 })
    expect(formatStatus(status)).toContain("- Tools: 1 available, 0 unknown; off by default: users_id_block and 1 more\n")
    expect(formatStatus(status)).not.toContain("\u001b")
    const many = Array.from({ length: 25 }, (_, i) => `send_chat_${i}`)
    const capped = buildStatus({ ...base, tools: many })
    expect(capped.deniedCount).toBe(25)
    expect(capped.deniedTools).toHaveLength(20)
    expect(formatStatus(capped)).toContain("and 5 more")
  })

  test("a failed rules insert shows its own restart step before the agent fix", () => {
    const problem = "RULES_NOT_ADDED: X's default permission rules could not be added (boom), so X tools may run without asking. Next step: Restart OpenCode."
    const status = buildStatus({ ...base, agents: [{ id: "reviewer", permissions: [allow("*")] }], problems: [problem] })
    expect(status.nextStep).toBe("Restart OpenCode.")
    expect(formatStatus(status)).toContain("- Access: " + POSTURE + "; default rules not added (see the OpenCode row)\n")
  })

  test("the rows come in the standard order, with X's own rows between Access and Tools", () => {
    const rows = formatStatus(buildStatus(base)).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(":")))
    expect(rows).toEqual(["Connection", "Account", "Access", "Server", "Client", "Callback", "Scopes", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    const bare = formatStatus(buildStatus({ host })).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(":")))
    expect(bare).toEqual(["Connection", "Account", "Access", "Server", "Tools", "Agents without default rules", "OpenCode", "Next step"])
  })

  test("an https callback shows the port a proxy forwards to", () => {
    const hosted = parsed({ client_id: "client-1", redirect_uri: "https://example.com/callback", callback_port: 8767 })
    const status = buildStatus({ ...base, options: hosted })
    expect(status.callback).toBe("https://example.com/callback")
    expect(status.callbackPort).toBe(8767)
    expect(formatStatus(status)).toContain("- Callback: https://example.com/callback (register exactly this URL in the app's User authentication settings, and forward it to http://127.0.0.1:8767/callback, where OpenCode listens)")
  })

  test("a skill of the same id at another path shadows the plugin's: status names it, after any other next step", () => {
    const own = [{ id: "x", path: "/pkg/skills/x/SKILL.md" }, { id: "x-write", path: "/pkg/skills/x-write/SKILL.md" }]
    const listed = [{ id: "x", path: "/projects/acme/.opencode/skills/x/SKILL.md" }, own[1]!, { id: "other", path: "/x" }]
    const status = buildStatus({ ...base, skills: { own, listed } })
    expect(status.shadowedSkills).toEqual([{ id: "x", path: "/projects/acme/.opencode/skills/x/SKILL.md" }])
    expect(status.nextStep).toBe(
      'Rename or move the "x" skill at /projects/acme/.opencode/skills/x/SKILL.md, which OpenCode loads instead of the plugin\'s skill of the same name.',
    )
    expect(buildStatus({ ...base, skills: { own, listed: own } })).not.toHaveProperty("shadowedSkills")
    expect(buildStatus({ ...base, skills: { own, listed }, agents: [{ id: "reviewer", permissions: [allow("*")] }] }).nextStep).toStartWith("Put the default rules")
  })

  test("an untested host and setup problems show on the OpenCode row; a problem's own next step comes first", () => {
    const outside = checkHost("2.3.0", true)
    const problem = 'SKILLS_INVALID: The "x" skill was not loaded: skills/x/SKILL.md is missing. Next step: Reinstall the plugin.'
    const status = buildStatus({ ...base, host: outside, problems: [problem] })
    expect(status.nextStep).toBe("Reinstall the plugin.")
    expect(formatStatus(status)).toContain(
      `- OpenCode: 2.3.0 (untested; supported range >=2.2.3 <2.3.0). It is outside the supported range; the plugin runs because allowUntestedHost is true. If X misbehaves, use OpenCode 2.2.3, 2.2.4, 2.2.5 or 2.2.6. ${problem}`,
    )
    expect(buildStatus({ ...base, host: outside }).nextStep).toBe(NOTHING_TO_DO)
    const inside = buildStatus({ ...base, host: checkHost("2.2.99", false) })
    expect(inside).toMatchObject({ state: "connected", host: { version: "2.2.99", tested: false }, nextStep: NOTHING_TO_DO })
    expect(buildStatus({ ...base, host: checkHost("2.2.99", false), server: { status: "needs_auth" } }).nextStep).toBe(SIGN_IN)
    expect(formatStatus(inside)).toContain("- OpenCode: 2.2.99 (untested; supported range >=2.2.3 <2.3.0)\n")
    expect(formatStatus(buildStatus({ ...base, host: checkHost("2.2.5", false) }))).toContain("- OpenCode: 2.2.5 (tested; supported range >=2.2.3 <2.3.0)\n")
  })

  test("the writes the Access row covers are the lists', not a fixed sentence", () => {
    expect(WRITE_TOOLS.length).toBe(8)
    expect(PUBLIC_TOOLS).toEqual(["create_posts"])
  })
})

function statusContext(server: string, skills: Promise<unknown> = Promise.resolve({ data: [] }), connection: Promise<unknown> = Promise.resolve({ type: "credential", id: "c1", label: "Example account", method: "oauth" })) {
  const ctx = {
    mcp: { list: async () => ({ data: [{ name: "github", status: { status: "connected" } }, { name: "x", status: { status: server }, integrationID: "mcp_fake" }] }) },
    integration: { connection: { active: async (id: string) => (id === "mcp_fake" ? connection : undefined) } },
    agent: { list: async () => ({ data: [guarded, { id: "reviewer", permissions: [allow("*")] }] }) },
    tool: {
      list: async () => [
        { id: "x_search_posts_all", name: "search_posts_all", options: { namespace: "x" } },
        { id: "x_shiny_new_tool", name: "shiny_new_tool", options: { namespace: "x" } },
        { id: "other_search", name: "search", options: { namespace: "other" } },
        { id: "read", name: "read" },
      ],
    },
    skill: { list: () => skills },
  }
  return ctx as unknown as StatusContext
}

describe("readStatus", () => {
  test("reads the connection, the sign-in's label, tools and agents through public APIs", async () => {
    const status = await readStatus(statusContext("connected"), { source: { type: "plugin", url: URL, signIn: "oauth" }, client: CLIENT, options: OPTS, host, problems: [], listing: { changedAt: () => 0 } })
    expect(status).toMatchObject({ state: "connected", account: "Example account", tools: 2, unknownTools: ["shiny_new_tool"], unguardedAgents: ["reviewer"], listing: false })
  })

  test("a sign-in without a label, another kind of connection, or a failed lookup leaves the account out", async () => {
    for (const connection of [Promise.resolve({ type: "credential", id: "c1", label: "", method: "oauth" }), Promise.resolve({ type: "env", id: "c2" }), Promise.reject(new Error("offline"))]) {
      const status = await readStatus(statusContext("connected", undefined, connection), { host })
      expect(status).toMatchObject({ state: "connected", tools: 2 })
      expect(status).not.toHaveProperty("account")
    }
  })

  test("no tools moments after a status change is still listing; later it is not", async () => {
    const empty = statusContext("connected")
    ;(empty as unknown as { tool: { list: () => Promise<unknown[]> } }).tool.list = async () => []
    expect(await readStatus(empty, { host, listing: { changedAt: () => Date.now() } })).toMatchObject({ listing: true })
    expect(await readStatus(empty, { host, listing: { changedAt: () => Date.now() - 60_000 } })).toMatchObject({ listing: false })
  })

  test("names shadowed skills from the host's list, and a failed skill list hides nothing else", async () => {
    const own = [{ id: "x", path: "/pkg/skills/x/SKILL.md" }]
    const listed = Promise.resolve({ data: [{ id: "x", path: "/home-skills/x/SKILL.md" }] })
    expect((await readStatus(statusContext("connected", listed), { host, skills: own })).shadowedSkills).toEqual([{ id: "x", path: "/home-skills/x/SKILL.md" }])
    const failed = await readStatus(statusContext("connected", Promise.reject(new Error("offline"))), { host, skills: own })
    expect(failed).toMatchObject({ state: "connected", tools: 2 })
    expect(failed).not.toHaveProperty("shadowedSkills")
  })
})

describe("/x-status", () => {
  async function run(read: () => Promise<Status>) {
    const posted: unknown[] = []
    let execute: ((input: { sessionID: string }) => Promise<void>) | undefined
    await registerStatusCommand(
      {
        command: { transform: async (callback) => (callback({ add: (definition) => void (execute = definition.execute as never) }), { dispose: async () => {} }) },
        session: { synthetic: async (input) => (posted.push(input), {}) as never },
      },
      read,
    )
    await execute!({ sessionID: "ses_1" })
    return posted
  }

  test("posts the status text into the session without starting a turn", async () => {
    const posted = await run(async () => buildStatus(base))
    expect(posted).toEqual([{ sessionID: "ses_1", text: formatStatus(buildStatus(base)), description: "X status", resume: false }])
  })

  test("posts a coded error with a next step, cut to one short line without URL queries, when status cannot be read", async () => {
    const posted = (await run(() => Promise.reject(new Error("failed:\n https://x.example/a?token=t")))) as { text: string }[]
    expect(posted[0]!.text).toBe("STATUS_UNAVAILABLE: Could not read X's status (failed: https://x.example/a). Next step: Restart OpenCode, then run /x-status again.")
  })
})

describe("status RPC", () => {
  async function register(read: () => Promise<Status>) {
    const registered: { id: string; methods: string[]; status: () => Promise<unknown> }[] = []
    const error = (type: string, message: string, data: unknown) => ({ type, message, data })
    await registerStatusRpc(
      {
        register: async (definition, handlers) => {
          registered.push({ id: definition.id, methods: Object.keys(definition.methods), status: () => handlers.status({} as never, { error } as never) })
          return { dispose: async () => {}, events: { emit: async () => {} } } as never
        },
      },
      read,
    )
    return registered
  }

  test("serves the same status as /x-status through one read-only method", async () => {
    const registered = await register(async () => buildStatus(base))
    expect(registered.map(({ id, methods }) => ({ id, methods }))).toEqual([{ id: "x.posts", methods: ["status"] }])
    expect(await registered[0]!.status()).toEqual(buildStatus(base))
    expect(StatusRpc.events).toEqual({})
  })

  test("answers a status it cannot read with its declared error, unavailable, and a next step", async () => {
    const registered = await register(() => Promise.reject(new Error("agent list failed")))
    expect(await registered[0]!.status()).toEqual({
      type: "unavailable",
      message: "STATUS_UNAVAILABLE: Could not read X's status (agent list failed).",
      data: { nextStep: "Restart OpenCode, then run /x-status again." },
    })
    expect(Object.keys(StatusRpc.methods.status.errors)).toEqual(["unavailable"])
  })

  test("has the fields every plugin of this family shares, with their names", () => {
    const status = buildStatus(base)
    expect({ version: status.version, host: status.host, state: status.state, unguardedAgents: status.unguardedAgents, nextStep: status.nextStep }).toEqual({
      version: VERSION,
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      state: "connected",
      unguardedAgents: [],
      nextStep: NOTHING_TO_DO,
    })
    expect(StatusRpc.methods.status.output.required).toEqual(expect.arrayContaining(["version", "host", "state", "unguardedAgents", "nextStep"]))
  })

  test("the output schema names every status field and requires the ones always present", () => {
    const { properties, required } = StatusRpc.methods.status.output
    const statuses: Status[] = [
      buildStatus({ ...base, account: "Example account", tools: ["shiny_new_tool"], agents: [{ id: "reviewer", permissions: [allow("*")] }], problems: ["p"], skills: { own: [{ id: "x", path: "/a" }], listed: [{ id: "x", path: "/b" }] } }),
      buildStatus({ ...base, server: { status: "failed", error: "fetch failed" }, source: { type: "conflict", url: "https://x.example/mcp", expected: URL }, host: checkHost("2.3.0", true) }),
      buildStatus({ host, setup: { code: "OPTIONS_INVALID", message: "Option apiKey: This option is not supported.", nextStep: "Remove it." } }),
    ]
    for (const status of statuses) {
      expect(Object.keys(status).filter((key) => !(key in properties))).toEqual([])
      expect(required.filter((key) => !(key in status))).toEqual([])
      expect(Object.keys(status.host).filter((key) => !(key in properties.host.properties))).toEqual([])
    }
  })
})
