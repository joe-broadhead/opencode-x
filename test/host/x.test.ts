// The plugin on the public @opencode/sdk host: H1 load and connect, H2 what runs and what asks, H3 the permission
// model (P1-P5), H4 adoption and conflict, H5 /x-status, H6 unload, the user's own server with a header secret that
// never reaches status or a script, the public Article publish on every path (direct, model turns with Code Mode off
// and on, scripts), the narrowing recipe, a server that asks for a sign-in, the fixed-client sign-in OpenCode starts
// and its pinned callback, and the /connect entry. Each describe owns one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import { REDIRECT_URI, SUPPORTED_HOST, TESTED_HOSTS, SCOPES } from "../../src/constants.js"
import { PUBLIC_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { StatusRpc } from "../../src/status.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { DENIED_SAMPLE, MODEL_ID, X_SCOPES } from "./fake-mcp.js"
import { agentRules, appOptions, attempt, cleanup, effect, HOST_VERSION, session, startHost, until, type Host } from "./harness.js"

const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
const AGENTS_NEXT_STEP = "Put the default rules shown by /x-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for X tools."
const KEY = "sk-fake-host-test-0123456789"
const SIGN_IN = "Run `/connect` and choose X, then press `o` or Enter to open the link (in a terminal, `opencode mcp auth x` opens it automatically)."
const SIGN_IN_AGAIN = "X needs a new sign-in. Choose this account to sign in again."

// Starting a host takes several seconds, more on a busy machine.
setDefaultTimeout(120_000)
afterAll(cleanup)

const BUILT_IN = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
const allow = (tool: string): Rule => ({ action: `x_${tool}`, resource: "*", effect: "allow" })
const deny = (tool: string): Rule => ({ action: `x_${tool}`, resource: "*", effect: "deny" })
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
/** The host hides a tool when the last rule matching its action is a deny on every resource. */
const hidden = (rules: readonly Rule[], action: string) => {
  const last = rules.findLast((rule) => wildcard(rule.action).test(action))
  return last?.resource === "*" && last.effect === "deny"
}

/** The host lists an MCP server's tools shortly after it connects. */
const xTools = (host: Host) =>
  until("X's tools are registered", async () => {
    const ids = (await host.probe().tool.list()).map((tool) => tool.id).filter((id) => id.startsWith("x_"))
    return ids.length === 15 && ids.sort()
  })

async function status(host: Host, sessionID: string) {
  await host.client.sessions.command({ sessionID, name: "x-status", text: "" })
  return until("/x-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

/** Enough of the tools RPC's contract for the client to call describe and two reads. */
const TOOLS_CONTRACT = {
  id: TOOLS_RPC_ID,
  methods: Object.fromEntries(["describe", "search_posts_all", "get_users_me"].map((name) => [name, { input: { type: "object" }, output: { type: "object" } }])),
  events: {},
}
type ToolsClient = Record<string, (input: object, options: object) => Promise<unknown>>
const toolsRpc = (host: Host) => (host.client.rpc as unknown as (definition: object) => ToolsClient)(TOOLS_CONTRACT)
/** A tools RPC call's output, or its error as JSON, so a test can search either for a secret. */
const scriptCall = (host: Host, method: string, input: object) =>
  toolsRpc(host)[method]!(input, { location: host.location }).then(
    (output) => JSON.stringify(output),
    (error: unknown) => JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})),
  )

const statusRpc = (host: Host) => (host.client.rpc as unknown as (definition: typeof StatusRpc) => { status: (input: object, options: object) => Promise<Record<string, unknown>> })(StatusRpc).status({}, { location: host.location })

describe(`the plugin on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ options: appOptions(), config: () => ({ agents: { reviewer: { description: "Reviews changes", mode: "subagent" } } }) })
  })
  afterAll(() => host?.close())

  test("the host's global folders, temp folder and working directory are inside the test's temp root", async () => {
    const global = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"].map((key) => join(process.env[key]!, "opencode"))
    expect(global.filter((path) => !existsSync(path))).toEqual([])
    const { paths } = await host.client.server.info()
    const used = [...global, realpathSync(paths.tmp), process.env.OPENCODE_TEST_HOME!, tmpdir(), process.cwd()]
    expect(used.filter((path) => !path.startsWith(ROOT + sep))).toEqual([])
  })

  test("H1: the plugin is active, x is connected, and its tools, skills and command are registered", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === "x.posts")?.state.status).toBe("active")
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    expect(servers.find((server) => server.name === "x")?.status).toEqual({ status: "connected" })
    expect(await xTools(host)).toEqual([...["search_posts_all", "get_users_me", "shiny_new_tool", ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENIED_SAMPLE].map((tool) => `x_${tool}`)].sort())
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("x")).sort()).toEqual([...SKILL_NAMES].sort())
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).toContain("x-status")
  })

  test("P1: the rules sit right after the base allow in every built-in agent, once", async () => {
    const rules = await agentRules(host)
    for (const id of BUILT_IN) {
      const permissions = rules.get(id)!
      const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect(base).toBe(0)
      expect(permissions.slice(base + 1, base + 1 + defaultRules().length)).toEqual(defaultRules())
      expect(permissions.filter((rule) => rule.action === "x_*")).toHaveLength(1)
    }
  })

  test("P1: Plan and Explore are not weakened", async () => {
    expect(await effect(host, "plan", "edit")).toBe("deny")
    expect(await effect(host, "explore", "x_search_posts_all")).toBe("deny")
    const explore = await session(host, "explore")
    expect(await attempt(host, explore, "explore", "search_posts_all", "reject", { query: "@example" })).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: x_search_posts_all" })
    const plan = await session(host, "plan")
    expect(await attempt(host, plan, "plan", "shiny_new_tool")).toMatchObject({ asked: "x_shiny_new_tool", ok: false })
  })

  test("P2 and H2: known reads run without a prompt, everything else asks, and publishing asks", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "search_posts_all", "reject", { query: "@example" })).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool", "reject", { query: "q" })).toEqual({ asked: "x_shiny_new_tool", ok: false, error: "Permission.DeclinedError: " })
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS]) {
      expect({ tool, result: await attempt(host, build, "build", tool, "reject", { query: "q" }) }).toEqual({ tool, result: { asked: `x_${tool}`, ok: false, error: "Permission.DeclinedError: " } })
    }
    // The off tools are hidden and refused with no prompt, even when "always" would be the answer.
    for (const tool of DENIED_SAMPLE) {
      expect({ tool, result: await attempt(host, build, "build", tool, "always", { query: "q" }) }).toEqual({ tool, result: { asked: undefined, ok: false, error: `Tool.Error: Permission denied: x_${tool}` } })
      expect(host.fake.calls).not.toContain(tool)
    }
    // Only the read reached X.
    expect(host.fake.calls.slice(before)).toEqual(["search_posts_all"])
    const rules = (await agentRules(host)).get("build")!
    expect(["x_search_posts_all", "x_create_users_bookmark", "x_create_posts", "x_shiny_new_tool"].filter((action) => hidden(rules, action))).toEqual([])
    for (const tool of DENIED_SAMPLE) expect(hidden(rules, `x_${tool}`)).toBe(true)
  })

  test("no script reaches a write, the public publish or an unknown tool: the tools RPC has no such method", async () => {
    const sessionID = await session(host)
    const described = await scriptCall(host, "describe", {})
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENIED_SAMPLE, "shiny_new_tool"]) {
      expect(described).not.toContain(tool)
      const call = (host.client.rpc as unknown as { call: (input: object) => Promise<unknown> }).call
      const outcome = await call({ rpcID: TOOLS_RPC_ID, method: tool, input: { sessionID, input: { query: "q" } }, location: host.location }).then(
        (output) => ({ ran: true, output }),
        (error: unknown) => ({ ran: false, error: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }),
      )
      expect(outcome).toMatchObject({ ran: false })
      expect(host.fake.calls).not.toContain(tool)
    }
  })

  test("P4: a saved 'Always allow' removes the prompt", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "shiny_new_tool", "always", { query: "q" })).toMatchObject({ asked: "x_shiny_new_tool", ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool", "reject", { query: "q" })).toMatchObject({ asked: undefined, ok: true })
    const { projectID } = await host.client.sessions.get({ sessionID: build })
    const saved = await host.client.permission.saved.list({ projectID })
    expect(saved.map(({ action, resource }) => ({ action, resource }))).toEqual([{ action: "x_shiny_new_tool", resource: "*" }])
  })

  test("P5: an agent defined only in user config gets no rules, and X tools run there unprompted", async () => {
    const reviewer = (await agentRules(host)).get("reviewer")!
    expect(reviewer.some((rule) => rule.action.startsWith("x_"))).toBe(false)
    const sessionID = await session(host, "reviewer")
    expect(await attempt(host, sessionID, "reviewer", "create_users_bookmark", "reject", { query: "q" })).toMatchObject({ asked: undefined, ok: true })
  })

  test("H5: /x-status reports the connection, client, callback, scopes, tools, the unguarded agent and its fix", async () => {
    await xTools(host)
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain("- Account: account name not reported by X's MCP\n")
    expect(text).toContain("- Access: reads run without asking; 11 tools ask first (bookmarks, lists, an Article draft, source keys and a public Post); 40 are off (DMs and chat, calls, follows, blocks, mutes, list membership, moderators and live video); X bills every tool call to the X developer account that owns the app; default rules missing in the agents listed below\n")
    expect(text).toContain("- Tools: 12 available, 1 unknown: shiny_new_tool (unknown tools ask before running); off by default: add_lists_member, send_chat_message and users_id_block\n")
    expect(text).toContain(`- Client: client-1 (configured app, confidential; set in plugin options)\n`)
    expect(text).toContain(`- Callback: ${REDIRECT_URI} (register exactly this URL in the app's User authentication settings)\n`)
    expect(text).toContain(`- Scopes: ${SCOPES.join(" ")}\n`)
    expect(text).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n`)
    expect(text).toContain(`- Next step: ${AGENTS_NEXT_STEP}`)
    expect(text).toContain(`- OpenCode: ${HOST_VERSION} (${TESTED_HOSTS.includes(HOST_VERSION) ? "tested" : "untested"}; supported range ${SUPPORTED_HOST})`)
    expect(text).not.toContain("secret-1")
    const output = await statusRpc(host)
    expect(output).toMatchObject({ state: "connected", tools: 12, deniedTools: [...DENIED_SAMPLE], unknownCount: 1, listing: false, unguardedAgents: ["reviewer"], client: { id: "client-1", mode: "confidential", source: "options" } })
    expect(JSON.stringify(output)).not.toContain("secret-1")
    expect(output).not.toHaveProperty("account")
  })

  test("H6: unloading the plugin removes the server, the rules and the command", async () => {
    // Registering a plugin with the same ID replaces the old generation, which disposes everything it registered.
    await host.client.plugin(Plugin.define({ id: "x.posts", setup: () => {} }))
    await until("the x server is gone", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return !data.some((server) => server.name === "x")
    })
    const rules = await agentRules(host)
    for (const id of BUILT_IN) expect(rules.get(id)!.some((rule) => rule.action.startsWith("x_"))).toBe(false)
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).not.toContain("x-status")
  })
})

describe("the user's own x server, with a secret in its headers", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({ mcp: { servers: { x: { type: "remote", url, oauth: false, headers: { "x-x-test": "user", Authorization: `Bearer ${KEY}` } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("H4: is adopted unchanged: the host sends its headers, and the plugin's rules still apply", async () => {
    expect(await attempt(host, await session(host), "build", "search_posts_all", "reject", { query: "@example" })).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, await session(host), "build", "create_users_bookmark", "reject", { query: "q" })).toMatchObject({ asked: "x_create_users_bookmark", ok: false })
    expect(host.fake.markers.length).toBeGreaterThan(0)
    expect(new Set(host.fake.markers)).toEqual(new Set(["user"]))
    expect(new Set(host.fake.authorizations)).toEqual(new Set([`Bearer ${KEY}`]))
  })

  test("the secret never reaches /x-status or the status RPC, which name the entry as the user's own", async () => {
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, your own mcp.servers.x without OAuth, used unchanged)`)
    const output = await statusRpc(host)
    expect(output).toMatchObject({ state: "connected", source: { type: "adopted", signIn: "own" } })
    for (const shown of [text, JSON.stringify(output)]) {
      expect(shown).not.toContain(KEY)
      expect(shown).not.toMatch(/Bearer|Authorization/i)
    }
  })

  test("the secret never reaches a script: not describe, a result or an upstream error", async () => {
    const sessionID = await session(host)
    const describe = await scriptCall(host, "describe", {})
    expect(describe).toContain("search_posts_all")
    const result = await scriptCall(host, "search_posts_all", { sessionID, input: { query: "@example" } })
    expect(result).toContain("called search_posts_all")
    const failure = await scriptCall(host, "search_posts_all", { sessionID, input: { query: "fail" } })
    expect(failure).toContain("UPSTREAM_ERROR")
    for (const shown of [describe, result, failure]) {
      expect(shown).not.toContain(KEY)
      expect(shown).not.toMatch(/Bearer/i)
    }
  })
})

/** Signs in through OpenCode's own flow: the authorization endpoint redirects the pinned loopback callback. */
async function signIn(host: Host) {
  const { data: servers } = await host.client.mcp.list({ location: host.location })
  const integrationID = servers.find((item) => item.name === "x")!.integrationID!
  const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
  const oauth = (host.client.integration as unknown as { oauth: Record<"connect", (input: object) => Promise<{ data: { attemptID: string; url: string } }>> }).oauth
  const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration.methods as { id: string }[])[0]!.id, location: host.location })
  const redirect = await fetch(attempt.url, { redirect: "manual" })
  const callback = redirect.headers.get("location")
  expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:8766\/callback/)
  await fetch(callback!)
  return attempt.url
}

const scripted = (host: Host) => host.client.sessions as unknown as {
  create: (input: object) => Promise<{ id: string }>
  prompt: (input: object) => Promise<unknown>
}

/** Refuses each permission a model turn raises, as an unattended session would, so the turn can finish. */
async function rejectPrompts(host: Host, sessionID: string) {
  await until("the model's permission request", async () => {
    const pending = await host.client.permission.list({ sessionID })
    if (!pending.length) return false
    for (const request of pending) await host.client.permission.reply({ sessionID, requestID: request.id, decision: "reject" })
    return true
  })
}

/** A host whose own `x` entry points at the fake, whose model is the fake's scripted model, with Code Mode on or off. */
async function modelHost(codemode: boolean) {
  const host = await startHost({
    config: (url) => ({
      mcp: { servers: { x: { type: "remote", url, oauth: false, ...(codemode ? {} : { codemode: false }) } } },
      // No model leaves the machine: LM Studio's local API is the fake; the other local providers are off.
      providers: { lmstudio: { settings: { baseURL: `${new URL(url).origin}/v1` } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    }),
  })
  const models = host.client as unknown as { model: { list: (input: object) => Promise<{ data: { id: string; providerID: string }[] }> } }
  await until("the scripted model is listed", async () => (await models.model.list({ location: host.location })).data.find((model) => model.providerID === "lmstudio" && model.id === MODEL_ID))
  await xTools(host)
  return host
}

describe("a model turn that asks for the public Article publish, with Code Mode off", () => {
  let host: Host
  beforeAll(async () => {
    host = await modelHost(false)
  })
  afterAll(() => host?.close())

  test("the model's own call asks, is not offered unprompted, and never reaches X when declined", async () => {
    host.fake.model.script = PUBLIC_TOOLS.map((tool) => ({ tool: `x_${tool}`, arguments: { query: "q" } }))
    const before = host.fake.model.requests.length
    const sessionID = (await scripted(host).create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    const turn = scripted(host).prompt({ sessionID, text: "Publish the Article." })
    await rejectPrompts(host, sessionID)
    await turn
    const turns = () => host.fake.model.requests.slice(before) as { tools?: { function?: { name?: string } }[]; messages?: { role: string }[] }[]

    const offered = turns().flatMap((request) => (request.tools ?? []).map((item) => item.function?.name ?? ""))
    expect(offered.filter((name) => name.startsWith("x_"))).toContain("x_get_users_me")
    // The tool is offered (the catch-all asks), and the declined call never reaches X.
    expect(offered).toContain("x_create_posts")
    expect(host.fake.calls).not.toContain("create_posts")
  })
})

describe("a Code Mode turn that asks for the public Article publish", () => {
  let host: Host
  beforeAll(async () => {
    host = await modelHost(true)
  })
  afterAll(() => host?.close())

  test("an inner tools.x call to publish asks inside the program and never reaches X; a read runs", async () => {
    const code = [
      "const results = []",
      "results.push(String((await tools.x.get_users_me({})) !== undefined))",
      "try { await tools.x.create_posts({ query: 'q' }); results.push('ran') } catch (error) { results.push('refused') }",
      "return results",
    ].join("\n")
    host.fake.model.script = [{ tool: "execute", arguments: { code } }]
    const before = host.fake.model.requests.length
    const sessionID = (await scripted(host).create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    const turn = scripted(host).prompt({ sessionID, text: "Publish the Article." })
    await rejectPrompts(host, sessionID)
    await turn
    expect(host.fake.model.requests.length).toBeGreaterThan(before)
    expect(host.fake.calls).toContain("get_users_me")
    expect(host.fake.calls).not.toContain("create_posts")
  })
})

describe("the documented narrowing recipe", () => {
  // A deny goes in the agent's own permissions, after the plugin's block in that agent.
  const narrow: Rule = { action: "x_create_posts", resource: "*", effect: "deny" }
  let host: Host
  beforeAll(async () => {
    host = await startHost({ options: appOptions(), config: () => ({ agents: { build: { permissions: [narrow] } } }) })
  })
  afterAll(() => host?.close())

  test("turns publishing off in that agent only, and leaves the other writes asking", async () => {
    await xTools(host)
    const rules = (await agentRules(host)).get("build")!
    expect(rules.indexOf(rules.find((rule) => JSON.stringify(rule) === JSON.stringify(narrow))!)).toBeGreaterThan(rules.findIndex((rule) => rule.action === "x_*"))
    expect(await effect(host, "build", "x_create_posts")).toBe("deny")
    expect(hidden(rules, "x_create_posts")).toBe(true)
    const build = await session(host)
    expect(await attempt(host, build, "build", "create_posts", "always", { query: "q" })).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: x_create_posts" })
    expect(host.fake.calls).not.toContain("create_posts")
    // The agents that use tools keep the plugin's ask; title and summary deny every tool, and Explore denies all.
    for (const id of ["general", "compaction", "plan"]) expect({ id, effect: await effect(host, id, "x_create_posts") }).toEqual({ id, effect: "ask" })
    for (const id of ["title", "summary"]) expect({ id, effect: await effect(host, id, "x_create_posts") }).toEqual({ id, effect: "deny" })
    // Explore denies everything, as it did before the plugin.
    expect(await effect(host, "explore", "x_create_posts")).toBe("deny")
    expect(await attempt(host, build, "build", "delete_users_bookmark", "reject", { query: "q" })).toMatchObject({ asked: "x_delete_users_bookmark", ok: false })
  })
})

describe("user permissions", () => {
  const userRules = [allow("create_users_bookmark"), deny("search_posts_all")]
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      options: appOptions(),
      config: () => ({
        permissions: userRules,
        // The documented fix for a config-only agent: the plugin's block first, then the user's rules again.
        agents: { reviewer: { description: "Reviews changes", mode: "subagent", permissions: [...defaultRules(), ...userRules] } },
      }),
    })
  })
  afterAll(() => host?.close())

  test("P3: a user allow on a write removes the prompt, and a user deny on a read hides it", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "create_users_bookmark", "reject", { query: "q" })).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "search_posts_all", "reject", { query: "@example" })).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: x_search_posts_all" })
    expect(hidden((await agentRules(host)).get("build")!, "x_search_posts_all")).toBe(true)
    expect(await attempt(host, build, "build", "shiny_new_tool", "reject", { query: "q" })).toMatchObject({ asked: "x_shiny_new_tool", ok: false })
  })

  test("P5: the per-agent fix guards a config-only agent and keeps the user's rules winning", async () => {
    const reviewer = await session(host, "reviewer")
    expect(await attempt(host, reviewer, "reviewer", "shiny_new_tool", "reject", { query: "q" })).toMatchObject({ asked: "x_shiny_new_tool", ok: false })
    expect(await attempt(host, reviewer, "reviewer", "create_users_bookmark", "reject", { query: "q" })).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, reviewer, "reviewer", "search_posts_all", "reject", { query: "@example" })).toMatchObject({ asked: undefined, ok: false })
    expect(await status(host, reviewer)).toContain("- Agents without default rules: none\n")
  })
})

describe("a user x server that points elsewhere", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: (url) => ({ mcp: { servers: { x: { type: "remote", url: url.replace(/\/mcp$/, "/other"), oauth: false } } } }) })
  })
  afterAll(() => host?.close())

  test("H4: is left in place and reported as a conflict", async () => {
    const text = await status(host, await session(host))
    const other = host.fake.url.replace(/\/mcp$/, "/other")
    expect(text).toContain(`- Connection: conflict (your mcp.servers.x points at ${other})`)
    expect(text).toContain(`- Next step: Your OpenCode config defines mcp.servers.x with ${other}, but the plugin uses ${host.fake.url}.`)
  })
})

// X's server answers 401 with a bare bearer challenge until the user signs in, or after its tokens are revoked. On
// the host's own MCP client that is a sign-in, not a failure: status says so, with the /connect step.
describe("a server that asks for a sign-in", () => {
  let host: Host
  beforeAll(async () => {
    // A token without a refresh token: a 401 then needs a new sign-in and keeps the credential, which is the account
    // /connect marks and the plugin clears.
    host = await startHost({ oauth: true, options: appOptions(), fake: { refreshTokens: false } })
  })
  afterAll(() => host?.close())

  /** The /connect entry's connections, with the status a credential shows there. */
  const connections = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((item) => item.name === "x")?.integrationID
    if (!integrationID) return []
    const { data } = await host.client.integration.get({ integrationID, location: host.location })
    return (data as unknown as { connections?: { status?: { status: string; message?: string } }[] }).connections ?? []
  }

  test("is sign-in required, with the /connect next step, in the RPC and in /x-status", async () => {
    await xTools(host)
    expect(await statusRpc(host)).toMatchObject({ state: "connected" })
    // A real sign-in leaves a credential: the account /connect marks when X stops accepting it.
    host.fake.challenge = true
    await signIn(host)
    await until("the sign-in stores a token", async () => host.fake.tokens.length === 1)
    expect(host.fake.tokens[0]).toMatchObject({ grant_type: "authorization_code" })
    expect(host.fake.tokens[0]).not.toHaveProperty("refresh_token")
    expect(host.fake.tokenAuthorizations[0]).toStartWith("Basic ")
    host.fake.challenge = false
    await until("the server is connected after the sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((item) => item.name === "x")?.status.status === "connected"
    })
    expect(await until("/connect shows the account", async () => (await connections()).find((item) => item.status?.message === undefined && (item as { type?: string }).type === "credential")))
    // The tokens stop working: the next connection gets the challenge.
    host.fake.challenge = true
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.disconnect({ server: "x", location: host.location })
    await mcp.connect({ server: "x", location: host.location }).catch(() => {})
    const server = await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      const found = data.find((item) => item.name === "x")
      return found?.status.status === "needs_auth" ? found : undefined
    })
    expect(server.status.status).toBe("needs_auth")
    // The plugin marks the /connect account, so the person sees which one to choose there.
    expect(await until("/connect shows the new sign-in on the account", async () => (await connections()).find((item) => item.status?.message === SIGN_IN_AGAIN)))
    expect(await statusRpc(host)).toMatchObject({ state: "sign_in_required", nextStep: SIGN_IN })
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: sign-in required (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain(`- Next step: ${SIGN_IN}`)
    expect(text).not.toMatch(/authorize|code_challenge/)
    // The same account connects again once X answers: the mark is the plugin's, and it clears its own.
    host.fake.challenge = false
    await mcp.connect({ server: "x", location: host.location })
    await until("the server is connected again", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((item) => item.name === "x")?.status.status === "connected"
    })
    expect(await until("/connect clears the sign-in mark", async () => ((await connections()).some((item) => item.status?.message) ? undefined : true))).toBe(true)
  })
})

// The plugin registers the server with the user's own app as a static client. X has no registration endpoint, so the
// sign-in must not try to register one, must use the pinned callback, and must ask for the pinned scopes.
describe("the sign-in OpenCode starts", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, options: appOptions() })
  })
  afterAll(() => host?.close())

  test("uses the static client, the pinned callback and the pinned scopes, and registers no client", async () => {
    await xTools(host)
    host.fake.challenge = true
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((item) => item.name === "x")?.integrationID
    expect(integrationID).toBeDefined()
    const { data: integration } = await host.client.integration.get({ integrationID: integrationID!, location: host.location })
    const methodID = (integration.methods as { id: string }[])[0]!.id
    const oauth = (host.client.integration as unknown as { oauth: Record<"connect" | "cancel", (input: object) => Promise<{ data: { attemptID: string; url: string } }>> }).oauth
    const { data: attempt } = await oauth.connect({ integrationID, methodID, location: host.location })
    try {
      const url = new URL(attempt.url)
      expect(`${url.origin}${url.pathname}`).toBe(`${host.fake.origin}/i/oauth2/authorize`)
      expect(url.searchParams.get("scope")).toBe(X_SCOPES)
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("client_id")).toBe("client-1")
      expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI)
      expect(host.fake.registrations).toHaveLength(0)
      // The metadata names no registration endpoint, so OpenCode uses the plugin's client as it is.
      const metadata = await fetch(`${host.fake.origin}/.well-known/oauth-authorization-server`).then((response) => response.json()) as Record<string, unknown>
      expect(metadata).not.toHaveProperty("registration_endpoint")
      expect(metadata).not.toHaveProperty("client_id_metadata_document_supported")
    } finally {
      await oauth.cancel({ integrationID, attemptID: attempt.attemptID, location: host.location }).catch(() => {})
    }
  })
})

describe("an X app client saved in /connect", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ options: {}, noServer: true, oauth: true })
  })
  afterAll(() => host?.close())

  const app = async () => {
    const { data } = await host.client.integration.list({ location: host.location })
    return data.find((item) => item.id === "x-app")
  }
  const status = () => (host.client.rpc as unknown as (definition: typeof StatusRpc) => { status: (input: object, options: object) => Promise<Record<string, unknown>> })(StatusRpc).status({}, { location: host.location })

  test("without one, X app is offered in /connect and no server is registered", async () => {
    expect(await status()).toMatchObject({ state: "not_configured", code: "CLIENT_ID_MISSING", nextStep: "Run /connect and choose X app, and paste your X app's client ID." })
    expect((await host.client.mcp.list({ location: host.location })).data.some((server) => server.name === "x")).toBe(false)
    expect(await app()).toMatchObject({
      name: "X app",
      methods: [{ type: "key", label: "X app client ID", form: [{ key: "client_secret", type: "string", title: "Client secret", required: false }] }],
    })
  })

  test("saving it registers the server with that client, the pinned callback and its secret", async () => {
    await host.client.integration.connect.key({ integrationID: "x-app", key: "CONNECT_CLIENT_ID", answer: { client_secret: "secret-2" }, location: host.location })
    const server = await until("the x server is registered", async () => (await host.client.mcp.list({ location: host.location })).data.find((item) => item.name === "x" && item.integrationID))
    expect(server.integrationID).toBeString()
    expect(await status()).toMatchObject({ client: { id: "CONNECT_CLIENT_ID", mode: "confidential", source: "connect" }, callback: REDIRECT_URI })
    // The registered entry carries the client and never shows it in status.
    expect(await xTools(host)).toHaveLength(15)
    expect(JSON.stringify(await status())).not.toContain("secret-2")
  })
})

// A public X app (Native App) has a client ID and no secret. The owner's team model shares one through managed
// config, so the sign-in must work with PKCE and `none` token authentication, and a refresh must carry no secret.
describe("a public client signs in", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, options: appOptions(false), fake: { expireFirstAccessToken: true } })
  })
  afterAll(() => host?.close())

  test("uses PKCE and a body client_id with no secret, and refreshes the same way", async () => {
    await xTools(host)
    host.fake.challenge = true
    const url = new URL(await signIn(host))
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBeString()
    expect(url.searchParams.get("client_id")).toBe("client-1")
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI)
    expect(url.searchParams.get("scope")).toBe(X_SCOPES)
    await until("the public client's token", async () => host.fake.tokens.length === 1)
    expect(host.fake.tokens[0]).toMatchObject({ grant_type: "authorization_code", client_id: "client-1" })
    expect(host.fake.tokens[0]).not.toHaveProperty("client_secret")
    expect(host.fake.tokens[0]!.code_verifier).toBeString()
    expect(host.fake.tokenAuthorizations[0]).toBeUndefined()
    host.fake.challenge = false
    await until("the server is connected after the public sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((item) => item.name === "x")?.status.status === "connected"
    })
    // The fake rejects the first access token with 401, so the next request refreshes it, still with no secret.
    await host.probe().mcp.reload()
    await until("the refresh request", async () => host.fake.tokens.length >= 2, 30_000)
    expect(host.fake.tokens[1]).toMatchObject({ grant_type: "refresh_token", client_id: "client-1" })
    expect(host.fake.tokens[1]).not.toHaveProperty("client_secret")
    expect(host.fake.tokens[1]).not.toHaveProperty("code_verifier")
    expect(host.fake.tokenAuthorizations[1]).toBeUndefined()
    // Status names the app kind and never a secret, which a public client does not have.
    const text = await status(host, await session(host))
    expect(text).toContain("- Client: client-1 (configured app, public; set in plugin options)")
  })
})

describe("the /connect entry", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, options: appOptions() })
  })
  afterAll(() => host?.close())

  const entry = async () => {
    const { data } = await host.client.mcp.list({ location: host.location })
    const integrationID = data.find((server) => server.name === "x")?.integrationID
    if (!integrationID) return undefined
    return (await host.client.integration.get({ integrationID, location: host.location })).data
  }

  test("is named X, also after the host reloads its MCP servers", async () => {
    expect((await until("the entry is named X", async () => ((await entry())?.name === "X" ? entry() : undefined)))?.methods).toHaveLength(1)
    await host.probe().mcp.reload()
    await until("the entry is named X again after the reload", async () => (await entry())?.name === "X")
    await Bun.sleep(1000)
    expect((await entry())?.name).toBe("X")
  })
})

