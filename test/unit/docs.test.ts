// The docs and skills must match the code: tool names, counts, error codes, the uninstall order and the Jelly guide.
// Every tool count they state is checked against src/x-tools.ts, so a change there cannot leave a stale number behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DENY_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"
import { defaultRules } from "../../src/permissions.js"
import { NAMESPACE_DESCRIPTION, PLUGIN_CODES, RPC_CODES, TESTED_HOSTS } from "../../src/constants.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
// Everything a user or the model reads about the current release.
const FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "AGENTS.md",
  ...readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`),
  ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`),
]
const KNOWN = [...READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS]
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")
// Every code the plugin raises, from the one typed table in src/constants.ts.
const CODES: readonly string[] = PLUGIN_CODES
// The tools RPC's budget code names the vendor on purpose: it is the plugin's own, not a shared host code.
const PREFIXED = ["X_BUDGET_EXCEEDED", "X_PRICE_UNKNOWN"]

// The owner removed every read limit: no text the model or a user reads may bring back a page, result-count or
// per-answer spend cap.
const REMOVED_READ_LIMITS = [
  "one page of at most ten",
  "one page of ten",
  "one small page",
  "`max_results` at most 10",
  "about $0.20",
  "keep result counts small",
  "result count small",
  "next-page token unless",
  "one widening",
  "widen once",
  "ten-result cap",
  "read cap",
]

describe("no read limits in the text", () => {
  test("the skills, the namespace description, README, docs, SECURITY and AGENTS name no page, count or spend cap", () => {
    const sources: Record<string, string> = { NAMESPACE_DESCRIPTION }
    for (const path of ["skills/x/SKILL.md", "skills/x-write/SKILL.md", "README.md", "SECURITY.md", "AGENTS.md", "docs/configuration.md", "docs/scripting.md", "docs/architecture.md"]) sources[path] = text(path).replace(/\s+/g, " ")
    const found = Object.entries(sources).flatMap(([where, body]) => REMOVED_READ_LIMITS.filter((phrase) => body.toLowerCase().includes(phrase)).map((phrase) => `${where}: ${phrase}`))
    expect(found).toEqual([])
  })
})

describe("docs", () => {
  test.each(FILES)("%s states no count of read, write or declared tools that could go stale", (file) => {
    const counts = [...text(file).matchAll(/\b\d+ (?:known )?(?:read|write|private write|read-only)(?:s\b| tools\b| read-only)|\b\d+ tools are declared/g)].map((match) => match[0])
    // The declaration holds every known tool and the plugin's own x_events_list.
    const stale = counts.filter((count) => !count.startsWith(`${READ_TOOLS.length} read`) && !count.startsWith(`${WRITE_TOOLS.length} write`) && !count.startsWith(`${WRITE_TOOLS.length} private write`) && count !== `${KNOWN.length + 1} tools are declared`)
    expect(stale).toEqual([])
  })

  test.each(FILES)("%s names only X tools the plugin knows, and its own x_events_list", (file) => {
    const named = [...text(file).matchAll(/\bx_([a-z][a-z_]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => ![...KNOWN, "events_list"].includes(tool))).toEqual([])
  })

  test.each(["docs/configuration.md", "docs/scripting.md", "docs/jelly.md", "SECURITY.md", "CHANGELOG.md"])("%s says nothing provisional or pending", (file) => {
    expect(text(file)).not.toMatch(/provisional|not yet (?:checked|published|signed)|private package|TODO/i)
  })

  test("the README and the configuration guide cover the three sign-up models and the team recipe", () => {
    const readme = text("README.md")
    expect(readme).toContain("## Who signs up for what")
    expect(readme).toContain("Your own app (the default)")
    expect(readme).toContain("A team app")
    expect(readme).toContain("The plugin ships **no client ID**")
    const guide = text("docs/configuration.md")
    expect(guide).toContain("## Team app")
    for (const words of [
      "Native App",
      "http://127.0.0.1:8766/callback",
      "http://localhost:8766/callback",
      "Pay-per-use → Production",
      "spending limit",
      "owned-reads discount",
      "Enterprise plan",
      "Developer Agreement",
      "Never** put a client secret in managed config",
    ]) {
      expect(guide).toContain(words)
    }
    expect(text("SECURITY.md")).toContain("A public client ID is not a secret")
    expect(text("SECURITY.md")).toContain("must never be distributed")
    expect(readme).toContain("X issued a Native App (public client) a refresh token on 2026-11-06")
  })

  test("the README's Known limits says the table was reconciled with the live list, which has no annotations", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8")
    const limits = readme.split("## Known limits")[1]?.split("## Uninstall")[0] ?? ""
    expect(limits).toContain("checked against X's live list on 2026-11-06")
    expect(limits).toContain("X publishes no tool annotations")
    expect(readme).not.toMatch(/provisional/i)
  })

  test("the README names no version of the plugin, not even in an example, except the install spec", () => {
    // D19: the README's install specs name release tags (the current one, and the previous one in the upgrade example),
    // and nothing else may name a version.
    expect(text("README.md").replace(/opencode-x#v\d+\.\d+\.\d+/g, "")).not.toMatch(/opencode-x@\d|\bv\d+\.\d+\.\d+\b|(?<![\d.])0\.\d+\.\d+(?![\d.])/)
  })

  test("the README and the configuration guide give the narrowing recipes, and no allow for any write", () => {
    for (const file of ["README.md", "docs/configuration.md"]) {
      const body = text(file)
      expect(body).toContain('{ "action": "x_create_posts", "resource": "*", "effect": "deny" }')
    }
    expect(text("docs/configuration.md")).toContain("The docs give no `allow` for a write")
    // No document may teach an allow for a private write or the public write, except the scripting guide's own session
    // grant: v2 requires a write to be granted by a prior rule, and that rule must be reviewable and scoped to the
    // script's session.
    const writeActions = [...WRITE_TOOLS, ...PUBLIC_TOOLS].map((tool) => `x_${tool}`)
    for (const file of FILES.filter((name) => name !== "docs/scripting.md")) {
      const raw = readFileSync(join(ROOT, file), "utf8")
      for (const action of writeActions) {
        expect({ file, action, allowed: new RegExp(`"action":\\s*"${action}"[^}]*"effect":\\s*"allow"`).test(raw) }).toEqual({ file, action, allowed: false })
      }
    }
    expect(text("README.md")).toContain("nothing asks: a change runs unattended")
    // The scripting guide's one grant for a write is a session's own permissions, after a blanket deny, never an
    // agent's rules or the top-level config.
    const scripting = readFileSync(join(ROOT, "docs/scripting.md"), "utf8")
    const grant = /"permissions":\[([^\]]*)\]/.exec(scripting)?.[1] ?? ""
    expect(grant).toContain('{"action":"x_create_users_bookmark","resource":"*","effect":"allow"}')
    expect(scripting).toContain("Session rules come after the agent's")
    expect(scripting).not.toMatch(/"agents"\s*:\s*\{[^}]*"permissions"/)
  })

  test("the secret has a documented environment route, and no example puts a literal one in the config", () => {
    for (const file of ["README.md", "docs/configuration.md", "SECURITY.md"]) {
      expect(text(file)).toContain("{env:X_CLIENT_SECRET}")
      expect(text(file)).toContain("empty string")
    }
    expect(text("README.md")).toContain("when OpenCode runs as a service or the desktop app")
    expect(text("docs/configuration.md")).toContain("### `{env:NAME}`")
    expect(text("docs/configuration.md")).toContain("`OPTIONS_INVALID` rejects")
    // The console page that issues the OAuth 2.0 pair, named the same way everywhere.
    for (const file of ["README.md", "docs/configuration.md"]) {
      expect(text(file)).toContain("User authentication settings")
      expect(text(file)).not.toContain("Keys and tokens")
    }
  })

  test("the README warns that dropping offline.access loses the refresh token, and has the matching row", () => {
    const readme = text("README.md")
    expect(readme).toContain("dropping `offline.access` means no refresh token")
    expect(readme).toContain("| Connection: sign-in required soon after signing in |")
    expect(readme).toContain("the two-hour token expired")
  })

  test.each(FILES)("%s puts no ask or allow recipe for an X tool at the top level, where it would reach Explore", (file) => {
    const raw = readFileSync(join(ROOT, file), "utf8")
    // Every JSON example that is a config: its top-level permissions only tighten.
    for (const [, body] of raw.matchAll(/```json\n([^]*?)```/g)) {
      let config: unknown
      try {
        config = JSON.parse(body!)
      } catch {
        continue
      }
      const top = !Array.isArray(config) && typeof config === "object" && config !== null ? ((config as { permissions?: { action: string; effect: string }[] }).permissions ?? []) : []
      expect(top.filter((rule) => rule.action.startsWith("x_") && rule.effect !== "deny")).toEqual([])
    }
    // Every ask or allow rule for one tool sits in an agent's own rules, said in its paragraph or code block. The
    // plugin's own block, which the plugin inserts itself, is the one exception.
    const blocks = raw.split(/\n\s*\n/)
    blocks.forEach((block, index) => {
      if (!/\{ "action": "x_[a-z_]+", "resource": "\*", "effect": "(?:ask|allow)" \}/.test(block)) return
      const context = `${blocks[index - 1] ?? ""}\n${block}`
      if (/The plugin adds these\s+rules/.test(context)) return
      const agentLevel = /agent's own|"agents"/.test(context) && !/\b(?:in|to) (?:your|the same) `permissions`|here or in an agent's own/.test(context.replace(/\s+/g, " "))
      expect({ file, block: block.slice(0, 120), agentLevel }).toEqual({ file, block: block.slice(0, 120), agentLevel: true })
    })
  })

  test("the docs use the plugin's own X app, never a shipped client, and never print a secret or a token", () => {
    expect(text("README.md")).toContain("a sign-in always goes through some developer's X app")
    expect(text("docs/configuration.md")).toContain("X has no dynamic client registration and no client metadata documents")
    for (const file of FILES) {
      expect(text(file)).not.toMatch(/Bearer (?!\{env:)[A-Za-z0-9_-]{8,}|X_CLIENT_SECRET=\S+|client_secret"\s*:\s*"[A-Za-z0-9]{8,}/)
      expect(text(file)).not.toMatch(/\bsk-[A-Za-z0-9]{8,}/)
    }
  })

  test("the README prints the generated default block for access all", () => {
    const readme = text("README.md")
    const block = defaultRules("all")
    expect(readme.replace(/\s+/g, " ")).toContain(JSON.stringify(block))
  })

  // R7: the configuration guide prints every value's generated block in full, and none of them is elided.
  test.each(["all", "ask-changes", "read-only"] as const)("the configuration guide prints the %s block in full", (access) => {
    const guide = readFileSync(join(ROOT, "docs/configuration.md"), "utf8")
    const marker = `\`access: "${access}"\``
    const at = guide.indexOf(marker)
    expect({ access, found: at !== -1 }).toEqual({ access, found: true })
    const start = guide.indexOf("```json", at)
    const end = guide.indexOf("```", start + 7)
    expect({ access, block: JSON.parse(guide.slice(start + 7, end)) }).toEqual({ access, block: defaultRules(access) })
    expect(guide.slice(start, end)).not.toMatch(/…|\.\.\.|the rest/)
  })

  // R8: a release added to the list cannot leave a stale "tested on …" sentence behind.
  test.each([
    ["README.md", "README.md"],
    ["AGENTS.md", "AGENTS.md"],
    ["SECURITY.md", "SECURITY.md"],
    ["docs/configuration.md", "docs/configuration.md"],
    ["CHANGELOG.md (Unreleased)", "CHANGELOG.md"],
  ])("%s names exactly TESTED_HOSTS wherever it says what is tested", (_label, file) => {
    const body = readFileSync(join(ROOT, file), "utf8")
    const mentions = body
      .split("\n")
      .flatMap((line) => line.split(/\.\s+/))
      .filter((sentence) => /\btested\b/i.test(sentence))
      // The supported range is not a tested release: drop a backticked `>=a.b.c <d.e.f` span before reading versions.
      .map((sentence) => sentence.replace(/`[^`]*>=[^`]*`/g, ""))
      .map((sentence) => [...sentence.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((version) => version[0]!))
      .filter((versions) => versions.length > 0)
    for (const versions of mentions) expect({ file, versions: [...new Set(versions)].sort() }).toEqual({ file, versions: [...TESTED_HOSTS].sort() })
  })

  test("the untested example is 2.2.99, and no doc names a later 2.2 release as tested", () => {
    const all = ["README.md", "AGENTS.md", "SECURITY.md", "docs/configuration.md", "CHANGELOG.md"].map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n")
    expect(all).toContain("2.2.99")
    expect(all).not.toMatch(/\b2\.2\.(?:7|8|9[0-8])\b(?!\d)/)
  })

  test("every call is billed, in the README, the skills, the namespace and status", () => {
    expect(text("README.md")).toContain("**X bills every tool call**")
    expect(text("README.md")).toContain("$0.005 per post read")
    expect(text("README.md")).toContain("5 November 2026")
    expect(text("skills/x/SKILL.md")).toContain("Every call costs money")
    expect(text("docs/scripting.md")).toContain("Every call costs money")
    expect(text("docs/configuration.md")).toContain("X bills every tool call to the X developer account that owns the app")
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout x` finds no server: sign out first.
  test("the README's Uninstall signs out before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    const logout = uninstall.indexOf("opencode mcp logout x")
    const list = uninstall.indexOf("opencode auth list")
    const remove = uninstall.indexOf("opencode plugin remove github:joe-broadhead/opencode-x#v0.0.2")
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(list).toBeGreaterThan(logout)
    expect(remove).toBeGreaterThan(list)
  })

  // R6: a code raised anywhere is in a table, and every table entry is raised. The shared tools RPC's codes are the
  // family's, documented in the scripting guide's refusal table; this plugin's own are CODES above.
  test("every code raised in src is in one of the two tables, and every plugin code is raised", () => {
    // The shared RPC's table, plus ACCOUNT_UNKNOWN, which only a per-account server raises and this plugin has none of.
    const rpcCodes: readonly string[] = [...RPC_CODES, "ACCOUNT_UNKNOWN"]
    // Not codes: Node's errno names, which a `code ===` comparison reads.
    const PLAIN = ["ENOENT", "EACCES", "EEXIST", "ENOTDIR", "EISDIR", "EPERM", "ENOSPC"]
    const files = readdirSync(join(ROOT, "src"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(entry.parentPath, entry.name))
    const found = new Set(
      files.flatMap((file) => {
        const body = readFileSync(file, "utf8")
        return [
          ...body.matchAll(/\b(?:errorText|xError)\(\s*"([A-Z][A-Z0-9_]+)"/g),
          ...body.matchAll(/["'`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):\s/g),
          ...body.matchAll(/\bcode:\s*"([A-Z][A-Z0-9_]+)"/g),
          ...body.matchAll(/\bcode\s*===\s*"([A-Z][A-Z0-9_]+)"/g),
        ].map((match) => match[1]!)
      }),
    )
    const known = new Set([...CODES, ...rpcCodes, ...PLAIN])
    expect([...found].filter((code) => !known.has(code))).toEqual([])
    expect(CODES.filter((code) => !found.has(code))).toEqual([])
    // The scripting guide's refusal table lists the shared codes, and no other.
    const guide = /## Errors([\s\S]*?)OpenCode itself/.exec(text("docs/scripting.md"))?.[1] ?? ""
    const missing = RPC_CODES.filter((code) => !guide.includes(`\`${code}\``))
    expect({ missing, tableFound: guide.length > 0 }).toEqual({ missing: [], tableFound: true })
  })

  // Every code the plugin raises has a row in the configuration guide and in the README's Troubleshooting.
  test("the configuration guide and the README document every error code the plugin raises, none with a service prefix", () => {
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const troubleshooting = /## Troubleshooting(.*?)## /.exec(text("README.md"))?.[1] ?? ""
    for (const code of CODES) {
      expect(PREFIXED.includes(code)).toBe(code.startsWith("X_"))
      expect(errors).toContain(`| \`${code}\` |`)
      expect({ code, inReadme: troubleshooting.includes(`\`${code}\``) }).toEqual({ code, inReadme: true })
    }
  })

  test("the configuration guide's Errors table lists only codes the plugin raises", () => {
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const documented = [...errors.matchAll(/\| `([A-Z][A-Z_]+)` \|/g)].map((match) => match[1]!)
    expect(documented.length).toBeGreaterThan(5)
    expect(documented.filter((code) => !CODES.includes(code))).toEqual([])
  })

  test("the README's X-specific rows name enrollment, scopes, cost and the missing posting tools", () => {
    const readme = text("README.md")
    expect(readme).toContain("client-not-enrolled")
    expect(readme).toContain("Pay-per-use")
    expect(readme).toContain("`403` on a write")
    expect(readme).toContain("Posting asks first")
    expect(readme).toContain("How much credit is left")
    expect(readme).toContain("`x_create_posts` is public. With `access: all` (the default) it runs without a prompt")
    expect(readme).toContain("Answers cost more than expected")
    expect(readme).toContain("`429`")
  })

  test("the Jelly guide describes the declaration as Jelly reads it, with no placeholder or version", () => {
    const guide = text("docs/jelly.md")
    expect(guide).not.toMatch(/`latest` is|None yet/)
    expect(guide).toContain("the one line in `jelly.summary`, and beside it the mark in `jelly.icon`")
    // Jelly's contracts drop an unknown top-level key; they do not refuse the declaration for it.
    expect(guide).toContain("drop a top-level key they don't know")
    expect(guide).not.toMatch(/refuses this declaration|accepts no unknown keys/)
    // A tool X adds later is undeclared, and Jelly runs it unasked: the guide says so plainly, a write included.
    expect(guide).toContain("A tool X adds later, a write included, is not declared, so in Jelly it is not asked about")
    expect(guide).toContain("it runs without asking, even if it changes something")
    expect(guide).toContain("**public**")
    const skills = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.skills as string[]
    expect(guide).toContain(`Declared: ${skills.map((name) => `\`${name}\``).join(", ")}.`)
  })

  test("the scripting guide points at the methods table, and gives X's cost, budget and rate limits", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`METHODS` in `src/host/tools-rpc.ts`)")
    expect(guide).toContain("`scriptBudgetUsd`")
    expect(guide).toContain("`X_BUDGET_EXCEEDED`")
    expect(guide).toContain("x-opencode-directory")
    expect(guide).toContain("Every call costs money")
    expect(guide).toContain("x-rate-limit-reset")
    expect(guide).toContain("make calls one at a time")
    expect(guide).toContain("A loop is still a loop")
    expect(guide).toContain("`start_time` and `end_time`")
  })

  test("no doc offers a search operator or parameter X does not have", () => {
    for (const file of ["README.md", "docs/scripting.md", "docs/configuration.md"]) {
      const body = text(file)
      for (const bad of ["since:", "until:", "min_faves:"]) expect({ file, bad, found: body.includes(bad) }).toEqual({ file, bad, found: false })
    }
  })
})
