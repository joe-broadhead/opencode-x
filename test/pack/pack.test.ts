// Pack, install and load the published shape. The tarball holds exactly the files whitelist and installs with
// lifecycle scripts disabled. Installed alone, it loads in each stock OpenCode release it is tested on, which provides
// @opencode/plugin, OpenTUI and Solid itself; next to those packages, both entry points also import under Bun.
// OPENCODE_BIN_2_2_3, OPENCODE_BIN_2_2_4 and OPENCODE_BIN_2_2_5 name stock binaries; otherwise each release is
// installed with npm, once per run. Every temp folder is a git repository under the system's /tmp, never under TMPDIR
// or HOME, so OpenCode's upward search for `.opencode` folders never reaches the agents of whoever runs the test.
// PACK_TARBALL names a tarball that was already packed, such as the one the release publishes, to test it instead.
// On each release a script also calls X's known reads through the tools RPC, against a loopback fake X, and the
// sign-in OpenCode starts is checked against a fake of X's sign-in server: the scopes it asks for and the client it
// registers.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform } from "node:os"
import { basename, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { ENDPOINT, REDIRECT_URI, SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { DENY_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { X_SCOPES, NEW_TOOL, startFakeMcp, UPSTREAM_FAILURE, type FakeMcp } from "../host/fake-mcp.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string
  version: string
  files: string[]
  exports: Record<string, string>
  devDependencies: Record<string, string>
}
// Outside the repository, so nothing resolves from the repository's own node_modules.
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "x-pack-")))
// A repository root, where OpenCode's search for `.opencode` folders and project config stops.
run("git", ["init", "--quiet", work], root)
// Removing the installed packages and binaries can take longer than the default hook timeout.
afterAll(() => rmSync(work, { recursive: true, force: true }), { timeout: 120_000 })

/** The host's ID for a remote MCP server's integration, derived from its name and URL. */
const integrationID = (name: string, url: string) => `mcp_${createHash("sha1").update(`${name}\0${url}`).digest("hex").slice(0, 16)}`

const MAX_FILES = 30
const MAX_PACKED_BYTES = 100 * 1024
// The two self-contained entry bundles, and nothing else, in dist/.
const DIST = ["dist/index.js", "dist/tui.js"]
// Modules the host serves to plugins at runtime. Everything else must be inlined in the bundle.
const SERVER_HOST_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/]
const TUI_HOST_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/, /^@opentui\//, /^solid-js(?:\/|$)/]
// The host packages OpenCode 2.2.3 ships; the versions come from devDependencies.
const HOST_PACKAGES = ["@opencode/plugin", "@opentui/core", "@opentui/solid", "solid-js"]
// The stock OpenCode releases the package is tested on: the one list in src/constants.ts.
const HOST_VERSIONS = TESTED_HOSTS
// OpenCode's own agents.
const BUILT_IN_AGENTS = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
// Anything a stock host tries on the network goes to a closed port, except loopback.
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_FREE_MODELS: "true",
}

type Packed = { filename: string; size: number; entryCount: number; files: { path: string }[] }

let packed: Packed | undefined
function pack(): Packed {
  if (packed) return packed
  const given = process.env.PACK_TARBALL
  if (given) {
    const tarball = resolve(given)
    copyFileSync(tarball, join(work, basename(tarball)))
    const files = run("tar", ["-tzf", tarball], root).trim().split("\n").filter((path) => !path.endsWith("/")).map((path) => ({ path: path.replace(/^package\//, "") }))
    packed = { filename: basename(tarball), size: statSync(tarball).size, entryCount: files.length, files }
    return packed
  }
  // Build first, explicitly: the package has no prepare or prepack hook, and a stale dist/ must never be packed.
  run("node", [join(root, "scripts", "check.mjs"), "build"], root)
  const result = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root)
  packed = (JSON.parse(result) as Packed[])[0]!
  return packed
}

/** An empty project with its own package.json, so npm never walks up to another one. */
function project(name: string): string {
  const dir = join(work, name)
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `x-pack-${name}`, private: true, type: "module" }))
  return dir
}

const installs = new Map<string, string>()
/** The tarball installed with scripts disabled, alone or next to the host packages. */
function install(withHostPackages: boolean): string {
  const name = withHostPackages ? "with-host-packages" : "alone"
  const existing = installs.get(name)
  if (existing) return existing
  const dir = project(name)
  const hosts = withHostPackages ? HOST_PACKAGES.map((item) => `${item}@${pkg.devDependencies[item]}`) : []
  run("npm", ["install", join(work, pack().filename), ...hosts, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  installs.set(name, dir)
  return dir
}

const installedPackage = (withHostPackages: boolean) => join(install(withHostPackages), "node_modules", ...pkg.name.split("/"))

/** A home, OpenCode's test home, XDG folders and a temp folder, all inside `base`. */
function isolated(base: string) {
  const home = join(base, "home")
  const env = {
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    TMPDIR: join(base, "tmp"),
  }
  for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true })
  return env
}

describe("package tarball", () => {
  test("lists exactly the files whitelist, under the size and file limits", () => {
    const { files, entryCount, size } = pack()
    const paths = files.map((file) => file.path).sort()
    const expected = ["package.json", ...pkg.files.flatMap((entry) => whitelisted(entry))].sort()
    expect(paths).toEqual(expected)
    expect(entryCount).toBeLessThan(MAX_FILES)
    expect(size).toBeLessThanOrEqual(MAX_PACKED_BYTES)
    expect(paths.filter((path) => path.includes("node_modules/") || /\.(?:tsx|jsx)$/.test(path))).toEqual([])
    for (const target of Object.values(pkg.exports)) expect(paths).toContain(target.replace(/^\.\//, ""))
    expect(paths.filter((path) => path.endsWith(".d.ts"))).toEqual([])
  }, 120_000)

  test("installs with scripts disabled and loads both entry points under Bun, next to the host packages", () => {
    const consumer = install(true)
    const probe = join(consumer, "probe.mjs")
    writeFileSync(probe, [
      "const out = {}",
      `for (const [part, specifier] of [["server", ${JSON.stringify(pkg.name)}], ["tui", ${JSON.stringify(`${pkg.name}/tui`)}]]) {`,
      "  const plugin = (await import(specifier)).default",
      "  out[part] = { id: plugin?.id, setup: typeof plugin?.setup }",
      "}",
      "console.log(JSON.stringify(out))",
    ].join("\n"))
    const output = run(process.execPath, [probe], consumer, { PATH: process.env.PATH, ...isolated(join(work, "bun-probe")) })
    expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({
      server: { id: "x.posts", setup: "function" },
      tui: { id: "x.posts.tui", setup: "function" },
    })
  }, 300_000)

  // OpenCode reloads a plugin in place and reuses the module records it holds for unchanged paths, so an entry that
  // imported a sibling module could get an older cached copy of it. Each entry must stand alone.
  test("dist holds only the two entry bundles, and they import no sibling module", () => {
    const dist = join(installedPackage(true), "dist")
    expect(tree(relative(root, dist), dist).sort()).toEqual(["index.js", "tui.js"])
    for (const file of ["index.js", "tui.js"]) expect(relativeImports(readFileSync(join(dist, file), "utf8"))).toEqual([])
  }, 300_000)

  test("dist imports only modules the host provides", () => {
    const dist = join(installedPackage(true), "dist")
    expect(foreign(join(dist, "index.js"), SERVER_HOST_MODULES)).toEqual([])
    expect(foreign(join(dist, "tui.js"), TUI_HOST_MODULES)).toEqual([])
  }, 300_000)
})

describe.each(HOST_VERSIONS)("installed alone, in stock OpenCode %s", (version) => {
  test("is active, registers x, names its /connect entry, adds the default rules, and answers the status RPC", async () => {
    const installed = installedPackage(false)
    const host = await serve(version, installed)
    try {
      const plugin = await host.until("the plugin finishes loading", async () => {
        const { data } = await host.api<{ data: { id: string; state: { status: string } }[] }>("GET", "/api/plugin")
        const found = data.find((item) => item.id === "x.posts")
        return found && found.state.status !== "loading" ? found : undefined
      })
      expect(plugin.state).toEqual({ status: "active" })

      const server = await host.until("the x server is registered", async () => {
        const { data } = await host.api<{ data: { name: string; integrationID?: string }[] }>("GET", "/api/mcp")
        return data.find((item) => item.name === "x")
      })
      // The ID OpenCode keys the sign-in by: the same name and URL as a sign-in made before the plugin was installed.
      expect(server.integrationID).toBe(integrationID("x", ENDPOINT))
      // /connect lists integrations from this endpoint, MCP servers first; X's sign-in shows under its brand.
      const listed = await host.until("/connect lists the server as X", async () => {
        const { data } = await host.api<{ data: { id: string; name: string; metadata?: { source?: string } }[] }>("GET", "/api/integration")
        const found = data.find((item) => item.id === server.integrationID)
        return found?.name === "X" ? found : undefined
      })
      expect(listed.metadata?.source).toBe("mcp")
      const build = await host.until("the build agent has the default rules", async () => {
        const { data } = await host.api<{ data: { id: string; permissions: Rule[] }[] }>("GET", "/api/agent")
        const permissions = data.find((agent) => agent.id === "build")?.permissions
        return permissions?.some((rule) => rule.action === "x_*") ? permissions : undefined
      })
      const rules = defaultRules("ask-changes")
      expect(build[0]).toEqual({ action: "*", resource: "*", effect: "allow" })
      expect(build.slice(1, 1 + rules.length)).toEqual(rules)

      const { output } = await host.api<{ output: Record<string, unknown> }>("POST", "/api/rpc/x.posts/status", { input: {} })
      expect(output).toMatchObject({
        version: pkg.version,
        source: { type: "plugin", url: ENDPOINT, signIn: "oauth" },
        unguardedAgents: ["reviewer"],
        host: { version, range: SUPPORTED_HOST, tested: true },
        problems: [],
      })
      // The project's agents are exactly OpenCode's own and the one its config defines: nothing came from a folder
      // above the temp root.
      const { data: agents } = await host.api<{ data: { id: string }[] }>("GET", "/api/agent")
      expect(agents.map((agent) => agent.id).filter((id) => !BUILT_IN_AGENTS.includes(id))).toEqual(["reviewer"])
      const { data: skills } = await host.api<{ data: { id: string; path: string }[] }>("GET", "/api/skill")
      const own = skills.filter((skill) => skill.id.startsWith("x")).map(({ id, path }) => ({ id, path }))
      expect(own.sort((a, b) => a.id.localeCompare(b.id))).toEqual([...SKILL_NAMES].sort().map((id) => ({ id, path: join(installed, "skills", id, "SKILL.md") })))
      expect(output).not.toHaveProperty("shadowedSkills")
      // Signed out: no sign-in, so no account label.
      expect(output).not.toHaveProperty("account")
    } catch (error) {
      throw new Error(`${(error as Error).message}\n--- opencode ${version} log ---\n${host.log().slice(-3000)}`)
    } finally {
      await host.close()
    }
  }, 600_000)
})

/** A copy of the installed package whose X URL points at the fake. */
function pointedAt(fake: FakeMcp, name: string) {
  const copy = join(work, "pointed", name)
  cpSync(installedPackage(false), copy, { recursive: true })
  const entry = join(copy, "dist", "index.js")
  const text = readFileSync(entry, "utf8")
  const quoted = JSON.stringify(ENDPOINT)
  expect(text.split(quoted).length - 1).toBe(1)
  writeFileSync(entry, text.replace(quoted, JSON.stringify(fake.url)))
  return copy
}

const rule = (action: string, effect: Rule["effect"]): Rule => ({ action, resource: "*", effect })
/** Two known reads that take any object. */
const READ_A = "search_posts_all"
const READ_B = "get_users_me"

// The `/x` dialog is a `ui.dialog.alert`. Its `r` key is live only until the alert's promise resolves, so the
// stock TUI must resolve it on every way the dialog can close. Each release's own code shows that it does: an alert
// resolves on its dialog's `onClose`, and every path that removes a dialog (replace, which another dialog opening uses,
// clear, which a click outside uses, Escape and Ctrl+C) calls `onClose` first. A release whose code differs fails here,
// and needs the dialog's close paths checked again. Ported from opencode-wisprflow.
describe.each(HOST_VERSIONS)("the stock TUI of OpenCode %s", (version) => {
  test("resolves a plugin's alert on every path that closes it, replacement by another dialog included", () => {
    const code = readFileSync(stockBinary(version)).toString("latin1")
    const facts = {
      "show passes onClose to replace": /show\((\w),(\w)\)\{\w\.replace\(\(\)=>\w\(\1\),\2\)\}/,
      "alert resolves on onClose": /alert\((\w)\)\{return new Promise\(\((\w)\)=>\{let (\w)=\w+\(\2\);\w\.show\(\(\)=>[^]{1,200}?onConfirm:\3\}\),\3\)\}\)\}/,
      "replace closes every dialog it removes": /replace\((\w),(\w),(\w)\)\{if\(\w\.stack\.length===0\)[^;]{1,80};for\(let (\w) of \w\.stack\)if\(\4\.onClose\)\4\.onClose\(\);/,
      "clear closes every dialog": /clear\(\)\{for\(let (\w) of \w\.stack\)if\(\1\.onClose\)\1\.onClose\(\);/,
    }
    expect(Object.fromEntries(Object.entries(facts).map(([fact, pattern]) => [fact, pattern.test(code)]))).toEqual(Object.fromEntries(Object.keys(facts).map((fact) => [fact, true])))
    // Escape and Ctrl+C each close the top dialog through its onClose.
    expect(code.match(/\.stack\.at\(-1\)\?\.onClose\?\.\(\),\w\("stack",\w\.stack\.slice\(0,-1\)\)/g)).toHaveLength(2)
  }, 600_000)
})

describe.each(HOST_VERSIONS)("the tools RPC on stock OpenCode %s", (version) => {
  let fake: FakeMcp
  let host: Awaited<ReturnType<typeof serve>>
  // Sessions by name; a name that is not here is passed as the session id itself.
  const sessions: Record<string, string> = {}

  /** A tools RPC call: its output, or the error's `{ type, code, message }`. */
  async function script(method: string, input: unknown, location: string | undefined = host.directory, headers: Record<string, string> = {}): Promise<Record<string, any>> {
    const response = await host.request("POST", `/api/rpc/${TOOLS_RPC_ID}/${method}`, { input }, location, headers)
    const body = response.body as Record<string, any>
    if (response.ok) return { value: body.output }
    const error = (body?.error ?? body) as Record<string, any>
    return { status: response.status, type: error?.type ?? error?._tag, code: error?.data?.code, message: String(error?.message ?? response.text) }
  }
  const call = (session: string, method: string, input: unknown) => script(method, { sessionID: sessions[session] ?? session, input })
  /** The tools the fake was asked to run since `from`. */
  const toolCalls = (from = 0) => fake.calls.slice(from)
  const status = async () => (await host.api<{ output: Record<string, any> }>("POST", "/api/rpc/x.posts/status", { input: {} })).output

  beforeAll(async () => {
    fake = await startFakeMcp({ catalog: "x" })
    host = await serve(version, pointedAt(fake, `tools-${version}`), {
      name: `tools-${version}`,
      // Config-only agents get no default rules: their own rules decide, after the host's defaults.
      agents: { locked: { permissions: [rule("x_*", "deny")] }, careful: { permissions: [rule(`x_${READ_A}`, "ask")] } },
    })
    // Every known tool except the 40 off ones, and the fake's new one, which is the only unknown.
    const tools = READ_TOOLS.length + WRITE_TOOLS.length + PUBLIC_TOOLS.length + DENY_TOOLS.length + 1
    await host.until(`x is connected with its ${tools} tools`, async () => {
      const output = await status()
      return output.state === "connected" && output.tools === tools && output.unknownCount === 1 && output.deniedCount === 0
    })
    const create = async (body: Record<string, unknown>) => {
      const created = await host.api<Record<string, any>>("POST", "/api/session", body)
      return (created.id ?? created.data?.id) as string
    }
    sessions.build = await create({ agent: "build" })
    sessions.locked = await create({ agent: "locked" })
    sessions.careful = await create({ agent: "careful" })
    sessions.agentless = await create({})
    // Session rules come after the agent's: one narrows build, the other reopens one tool for locked.
    sessions.narrow = await create({ agent: "build", permissions: [rule(`x_${READ_A}`, "deny")] })
    sessions.reopen = await create({ agent: "locked", permissions: [rule(`x_${READ_A}`, "allow")] })
    // A script's own grant: a blanket deny, then one write and the public send, for that session only.
    sessions.granted = await create({ agent: "build", permissions: [rule("x_*", "deny"), rule("x_create_users_bookmark", "allow"), rule("x_create_posts", "allow")] })
  }, 600_000)
  afterAll(async () => {
    await host?.close()
    await fake?.close()
  }, 60_000)

  test("status and the status RPC make no X call", async () => {
    const from = fake.calls.length
    await status()
    await host.api("POST", "/api/rpc/x.posts/status", { input: {} })
    expect(fake.calls.slice(from)).toEqual([])
  })

  test("describes exactly the known tools, each with its class, available and with its live schema", async () => {
    const { value } = await script("describe", {})
    expect(value.id).toBe(TOOLS_RPC_ID)
    expect(value.methods.map((method: { name: string }) => method.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS])
    const classes: Record<string, string> = {}
    for (const method of value.methods) classes[method.class] = (classes[method.class] ?? "") + "."
    expect(classes).toEqual({ read: ".".repeat(READ_TOOLS.length), write: ".".repeat(WRITE_TOOLS.length), send: ".", destructive: ".".repeat(DENY_TOOLS.length) })
    for (const method of value.methods) {
      expect({ name: method.name, kind: method.kind, action: method.action, available: method.available }).toEqual({
        name: method.name,
        kind: "mcp",
        action: `x_${method.name}`,
        available: true,
      })
      expect(method.input).toEqual({ type: "object", properties: { query: { type: "string" } } })
      expect(Object.hasOwn(method, "permission")).toBe(false)
    }
    expect(value.unclassified).toEqual([NEW_TOOL.name])
  })

  test("with a session, gives each method's resolved permission", async () => {
    const { value } = await script("describe", { sessionID: sessions.build })
    const permission = Object.fromEntries(value.methods.map((method: { name: string; permission: string }) => [method.name, method.permission]))
    expect(permission[READ_A]).toBe("allow")
    expect(permission.create_users_bookmark).toBe("ask")
    expect(permission.users_id_block).toBe("ask")
  })

  test("runs a known read as the session's agent, with no model turn", async () => {
    const from = fake.called.length
    const result = await call("build", READ_A, { query: "hello" })
    expect(result).toMatchObject({ value: { output: { tool: READ_A, path: "/mcp", arguments: { query: "hello" } }, text: expect.stringContaining(`called ${READ_A}`) } })
    expect(result.value.output.cost).toMatchObject({ estimateUsd: 0.005, actualUsd: 0.005 })
    expect(fake.called.slice(from)).toEqual([{ tool: READ_A, path: "/mcp" }])
    const { data: info } = await host.api<{ data: Record<string, any> }>("GET", `/api/session/${sessions.build}`)
    expect(info.tokens).toMatchObject({ input: 0, output: 0 })
    expect(info.outcome).toBeUndefined()
  })

  test("gives a result with only text that text as its output too, as docs/scripting.md says", async () => {
    expect(await call("build", READ_B, { query: "text" })).toMatchObject({ value: { output: { cost: expect.any(Object) }, text: expect.stringContaining(`text from ${READ_B}`) } })
  })

  test("never makes an unknown tool a method, though OpenCode lists it", async () => {
    const from = fake.calls.length
    expect(await call("build", NEW_TOOL.name, { query: "q" })).toMatchObject({ type: "rpc.method_not_found" })
    expect(toolCalls(from)).toEqual([])
  })

  test("refuses a write, the public Post and an off tool that no rule allows, before X is called", async () => {
    const from = fake.calls.length
    for (const name of ["create_users_bookmark", "create_posts", "send_chat_message"]) {
      const result = await call("build", name, { query: "q" })
      expect({ name, code: result.code }).toEqual({ name, code: "PERMISSION_DENIED" })
      expect(result.message).toMatch(/would ask|hidden from this session's agent/)
    }
    expect(toolCalls(from)).toEqual([])
  })

  test("runs a write and the public Post that the session's own rules allow", async () => {
    const from = fake.called.length
    expect((await call("granted", "create_users_bookmark", { query: "q" })).value).toMatchObject({ output: { tool: "create_users_bookmark" } })
    expect((await call("granted", "create_posts", { query: "q" })).value).toMatchObject({ output: { tool: "create_posts" } })
    expect(fake.called.slice(from)).toEqual([
      { tool: "create_users_bookmark", path: "/mcp" },
      { tool: "create_posts", path: "/mcp" },
    ])
    // The same session's blanket deny still refuses every other tool.
    expect(await call("granted", READ_A, { query: "q" })).toMatchObject({ code: "PERMISSION_DENIED" })
  })

  test("refuses a session whose agent denies X, before X is called", async () => {
    const from = fake.calls.length
    expect(await call("locked", READ_A, { query: "q" })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(toolCalls(from)).toEqual([])
  })

  test("refuses an ask at once, and leaves no approval prompt waiting", async () => {
    const from = fake.calls.length
    const result = await call("careful", READ_A, { query: "q" })
    expect(result).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(result.message).toMatch(/would ask for this session's agent, and a script cannot answer/)
    const { data: pending } = await host.api<{ data: unknown[] }>("GET", "/api/permission/request")
    expect(pending.filter((request) => JSON.stringify(request).includes(sessions.careful!))).toEqual([])
    expect(toolCalls(from)).toEqual([])
    // The same agent's other reads have no ask, so they run.
    expect((await call("careful", READ_B, { query: "q" })).value).toMatchObject({ output: { tool: READ_B } })
  })

  test("applies the session's rules after the agent's", async () => {
    expect(await call("narrow", READ_A, { query: "q" })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect((await call("narrow", READ_B, { query: "q" })).value).toMatchObject({ output: { tool: READ_B } })
    expect((await call("reopen", READ_A, { query: "q" })).value).toMatchObject({ output: { tool: READ_A } })
    expect(await call("reopen", READ_B, { query: "q" })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
  })

  test("gives X's own error as UPSTREAM_ERROR: its first line, with the signed URL redacted", async () => {
    const result = await call("build", READ_B, { query: "fail" })
    expect(result).toMatchObject({ type: "failed", code: "UPSTREAM_ERROR" })
    expect(result.message).toContain("https://files.x.example/a.png?[redacted]")
    for (const hidden of ["fake-signature-123", "second line"]) expect(result.message).not.toContain(hidden)
    expect(UPSTREAM_FAILURE).toContain("fake-signature-123")
  })

  test("names an unknown session, a session without an agent, and rejects an envelope with extra keys", async () => {
    expect(await call("ses_does_not_exist", READ_A, { query: "q" })).toMatchObject({ type: "failed", code: "SESSION_UNKNOWN" })
    expect(await call("agentless", READ_A, { query: "q" })).toMatchObject({ type: "failed", code: "SESSION_AGENT_REQUIRED" })
    const from = fake.calls.length
    for (const envelope of [{ sessionID: sessions.build, input: { query: "q" }, extra: true }, { input: { query: "q" } }, { sessionID: sessions.build, input: "q" }])
      expect(await script(READ_A, envelope)).toMatchObject({ type: "rpc.invalid_input" })
    expect(toolCalls(from)).toEqual([])
  })

  test("stops a session at its spend budget with X_BUDGET_EXCEEDED, before the next X call", async () => {
    const budgeted = await (async () => {
      const created = await host.api<Record<string, any>>("POST", "/api/session", { agent: "build" })
      return (created.id ?? created.data?.id) as string
    })()
    // The fake's "cost" search returns ten posts and their ten authors, $0.15 a call; the default budget is $1.00.
    for (let read = 0; read < 7; read++) expect((await call(budgeted, READ_A, { query: "cost" })).value).toBeDefined()
    const from = fake.calls.length
    const refused = await call(budgeted, READ_A, { query: "cost" })
    expect(refused.code).toBe("X_BUDGET_EXCEEDED")
    expect(refused.message).toMatch(/scriptBudgetUsd/)
    expect(fake.calls.length).toBe(from)
  })

  test("the location decides: another location answers rpc.unavailable, and the query and the header name this one", async () => {
    // A second directory in the same temp root, with no plugin: the host answers before any handler runs.
    const elsewhere = join(host.directory, "..", "elsewhere")
    mkdirSync(elsewhere, { recursive: true })
    const body = { input: { sessionID: sessions.build, input: { query: "q" } } }
    const missing = await host.request("POST", `/api/rpc/${TOOLS_RPC_ID}/${READ_A}`, body, elsewhere)
    expect(missing.ok).toBe(false)
    expect(missing.text).toContain("rpc.unavailable")
    expect((await host.request("POST", `/api/rpc/${TOOLS_RPC_ID}/${READ_A}`, body, host.directory)).ok).toBe(true)
    expect((await host.request("POST", `/api/rpc/${TOOLS_RPC_ID}/${READ_A}`, body, undefined, { "x-opencode-directory": host.directory })).ok).toBe(true)
  })

  // Last in this block: from here the fake answers every MCP request with X's sign-in challenge. X has no
  // registration endpoint, so OpenCode must use the plugin's static client: the pinned callback, the pinned scopes,
  // the client ID from the options, and the secret as basic authentication at the token endpoint.
  test("the sign-in it starts uses the static client and the pinned callback, and registers no client", async () => {
    fake.challenge = true
    const id = integrationID("x", fake.url)
    const { data: integration } = await host.api<{ data: { methods: { id: string }[] } }>("GET", `/api/integration/${id}`)
    const started = await host.api<Record<string, any>>("POST", `/api/integration/${id}/connect/oauth`, { methodID: integration.methods[0]!.id })
    const attempt = (started.data ?? started) as { attemptID: string; url: string }
    const url = new URL(attempt.url)
    expect(`${url.origin}${url.pathname}`).toBe(`${fake.origin}/i/oauth2/authorize`)
    expect(url.searchParams.get("scope")).toBe(X_SCOPES)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("client_id")).toBe("client-1")
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI)
    // The stock releases send no prompt=consent with offline.access: docs/architecture.md, "Platform facts".
    expect(url.searchParams.get("prompt")).toBeNull()
    expect(fake.registrations).toHaveLength(0)
    // Complete the flow: the authorization endpoint redirects the pinned loopback callback, and the token endpoint
    // receives the secret as basic authentication.
    const redirect = await fetch(attempt.url, { redirect: "manual" })
    expect(redirect.headers.get("location")).toStartWith(REDIRECT_URI)
    await fetch(redirect.headers.get("location")!)
    await host.until("the token request", async () => fake.tokens.length === 1)
    expect(fake.tokens[0]).toMatchObject({ grant_type: "authorization_code" })
    expect(fake.tokenAuthorizations[0]).toStartWith("Basic ")
    expect(Buffer.from(fake.tokenAuthorizations[0]!.slice("Basic ".length), "base64").toString()).toBe("client-1:secret-1")
  })
})

/**
 * OPENCODE_BIN_<version>, or the unmodified npm release with its platform binary, installed with scripts disabled.
 * Installed once per version: several describe blocks serve the same release.
 */
const installed = new Map<string, string>()
function stockBinary(version: string): string {
  const given = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (given) return given
  const cached = installed.get(version)
  if (cached) return cached
  const binary = `@opencode/cli-${platform()}-${arch()}`
  const dir = project(`opencode-${version}`)
  // Only this platform's binary: each one is a few hundred megabytes.
  run("npm", ["install", `@opencode/cli@${version}`, `${binary}@${version}`, "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  const path = join(dir, "node_modules", binary, "bin", "opencode")
  installed.set(version, path)
  return path
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as { port: number }
  await new Promise((done) => server.close(done))
  return port
}

/**
 * `opencode serve` on its own port and password, in an environment that holds only its temp root and is offline, with
 * a project that loads the installed package and defines agents only in user config (by default one, `reviewer`).
 */
async function serve(version: string, installed: string, options: { readonly name?: string; readonly agents?: Record<string, unknown> } = {}) {
  const binary = stockBinary(version)
  const base = join(work, options.name ?? `stock-${version}`)
  const directory = join(base, "project")
  // Keep the built-in local providers from probing their default ports.
  const providers = { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } }
  mkdirSync(directory, { recursive: true })
  const agents = options.agents ?? { reviewer: { description: "Reviews changes", mode: "subagent" } }
  writeFileSync(join(directory, "opencode.json"), JSON.stringify({ plugins: [{ package: installed, options: { oauth: { client_id: "client-1", client_secret: "secret-1" }, scriptDailyBudgetUsd: 100, access: "ask-changes" } }], agents, providers }))
  const password = randomUUID()
  const env = { ...isolated(base), ...OFFLINE, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", OPENCODE_PASSWORD: password }

  expect(run(binary, ["--version"], directory, env).trim()).toBe(`opencode v${version}`)
  // OpenCode resolves every global path from this environment; none may leave the temp root.
  const paths = run(binary, ["debug", "paths"], directory, env).trim().split("\n").map((line) => line.trim().split(/\s+/))
  expect(paths.length).toBeGreaterThan(5)
  expect(paths.filter(([, path]) => !path?.startsWith(base + sep))).toEqual([])

  const port = await freePort()
  let log = ""
  const server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => void (log += chunk))
  server.stderr.on("data", (chunk) => void (log += chunk))
  const exited = new Promise((done) => server.once("exit", done))

  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  /** The response's status and parsed body, whatever the status. A call with no location is the location case. */
  const request = async (method: string, path: string, body?: unknown, location: string | undefined = directory, headers: Record<string, string> = {}) => {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    if (location !== undefined) url.searchParams.set("location[directory]", location)
    const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // Not JSON: keep the text.
    }
    return { status: response.status, ok: response.ok, text, body: parsed }
  }
  const api = async <T>(method: string, path: string, body?: unknown, location = directory): Promise<T> => {
    const response = await request(method, path, body, location)
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${response.text.slice(0, 500)}`)
    return response.body as T
  }
  /** Polls until `read` returns a value. The server answers before plugins finish loading, more slowly when busy. */
  const until = async <T>(what: string, read: () => Promise<T | false | undefined>, ms = 180_000): Promise<T> => {
    for (const deadline = Date.now() + ms; ; await Bun.sleep(500)) {
      const value = await read().catch((error: unknown) => (Date.now() > deadline ? Promise.reject(error) : undefined))
      if (value) return value
      if (server.exitCode !== null) throw new Error(`opencode ${version} exited before ${what}`)
      if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    }
  }
  const close = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    server.kill("SIGTERM")
    const timer = setTimeout(() => server.kill("SIGKILL"), 10_000)
    await exited
    clearTimeout(timer)
  }
  return { api, request, until, close, directory, log: () => log }
}

// The files a `files` entry should put in the tarball. dist/ must hold exactly the two bundles, so stale or foreign
// build output fails the comparison, and so does a missing whitelisted file.
function whitelisted(entry: string): string[] {
  if (entry === "dist") return DIST
  const path = join(root, entry)
  if (!existsSync(path)) return [`${entry} (missing)`]
  return statSync(path).isDirectory() ? tree(entry) : [entry]
}

/** Every file under `dir`, as paths relative to `base` (the repository root by default). */
function tree(dir: string, base = root): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name !== ".DS_Store")
    .map((item) => relative(base, join(item.parentPath, item.name)).split(sep).join("/"))
}

/** Every module specifier in a file: static imports and re-exports, dynamic `import()` and `require()`. */
const specifiers = (source: string) =>
  [...source.matchAll(/(?:^|[\s;}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["'`]?([^"'`)]*)["'`]?\s*\)/g)].map((match) => (match[1] ?? match[2])!)

/** Relative imports, and every dynamic `import()` or `require()` call: a self-contained bundle has none. */
const relativeImports = (source: string) => [
  ...specifiers(source).filter((specifier) => specifier.startsWith(".")),
  ...[...source.matchAll(/(?<![\w$.])(?:import|require)\s*\(/g)].map((match) => match[0]),
]

/** The bare specifiers of one bundle that the allowed list does not cover. */
const foreign = (file: string, allowed: RegExp[]) =>
  [...new Set(specifiers(readFileSync(file, "utf8")).filter((specifier) => !allowed.some((pattern) => pattern.test(specifier))))].sort()

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = { ...process.env, npm_config_update_notifier: "false" }): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}
