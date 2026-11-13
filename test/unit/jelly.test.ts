import { describe, expect, test } from "bun:test"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { DENY_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"
import { METHODS } from "../../src/host/tools-rpc.js"
import { defaultRules, evaluate } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { parseOptions } from "../../src/options.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, readPackage } from "../support/jelly-kit.js"
import { ACCESS_CHOICES, type PluginSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base allow
 * rule, so this plugin's own rules never reach them: Jelly writes each declared "ask" or "deny" as that tool's default.
 * The shared kit checks the declaration against Jelly's plugin authors' standard; the tests below add what only X
 * declares.
 */

const BASE_ALLOW = { action: "*", resource: "*", effect: "allow" as const }
const ROOT = new URL("../../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & {
  tools: DeclaredTool[]
  skills: string[]
  rpc: unknown[]
  views: unknown[]
  signIns: unknown[]
  contributes: unknown
}
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))
// Every live tool, and the plugin's own x_events_list.
const known = [...READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS, "events_list"].map((tool) => `${SERVER_NAME}_${tool}`)

describe("the jelly declaration", () => {
  test("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: (permission) => evaluate([BASE_ALLOW, ...defaultRules()], permission), registered: known })).toEqual([])
  })

  test("declares every live tool once, with the all-allow effect the default rules give it", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS]) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "allow", readOnly: false })
    for (const tool of DENY_TOOLS) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "allow" })
    for (const method of METHODS) expect(byPermission.get(`x_${method.name}`)?.readOnly, method.name).toBe(method.class === "read")
    // Memory's collector runs x_events_list unattended, so it never asks.
    expect(byPermission.get("x_events_list")).toEqual({ name: "x.events_list", permission: "x_events_list", effect: "allow", readOnly: true })
    expect(jelly.tools).toHaveLength(known.length)
    for (const tool of jelly.tools) expect(Object.keys(tool).sort()).toEqual(["effect", "name", "permission", "readOnly"])
  })

  test("names every skill the package ships, both sign-ins, and no views, RPC, feeds or widgets", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect(jelly.skills).toEqual([...SKILL_NAMES])
    expect(jelly.signIns).toEqual([
      { id: "app", label: "X app client ID", integration: "x-app", presetBy: "oauth.client_id" },
      { id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME, after: "app" },
    ])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({
      homeFeeds: [],
      homeWidgets: [],
      workKinds: [],
      settings: [
        { key: "access", label: "Access", type: "string", choices: ACCESS_CHOICES, default: "all", description: "all, ask-changes or read-only. Generates default rules for agents with a base allow rule." },
        {
          key: "scriptBudgetUsd",
          label: "Script budget per session (USD)",
          type: "number",
          min: 0.01,
          step: 0.01,
          description:
            "An opt-in spend budget for each script session, in US dollars. A call whose estimate would not fit is refused before it reaches X. Leave it unsaved for no budget: X's own billing and app spending limit apply.",
        },
        {
          key: "scriptDailyBudgetUsd",
          label: "Script budget per 24 hours (USD)",
          type: "number",
          min: 0.01,
          step: 0.01,
          description: "An opt-in cap on all script spending in any 24 hours, in US dollars, across sessions, jobs and reloads. It counts estimated spend. Leave it unsaved for no cap.",
        },
      ],
    })
  })
})

describe("the jelly settings", () => {
  const { settings } = jelly.contributes as { settings: PluginSetting[] }
  const setting = (key: string) => settings.find((item) => item.key === key)!
  const takes = (options: Record<string, unknown>) => parseOptions(options).ok

  test("pass Jelly's setting contract", () => {
    expect(settingsProblems(settings)).toEqual([])
  })

  test("offer only access values the parser takes, with its default, and the parser refuses one outside the set", () => {
    const access = setting("access")
    const parsed = parseOptions({})
    expect(parsed.ok && parsed.options.access).toBe(access.default as "all")
    for (const value of settingChoices(access)!.map((choice) => choice.value)) {
      expect(settingValueIssue(access, value)).toBeNull()
      const result = parseOptions({ access: value })
      expect(result.ok && (result.options.access as string)).toBe(value)
    }
    for (const outside of ["write", "read", "none", ""]) {
      expect(settingValueIssue(access, outside)).not.toBeNull()
      expect(takes({ access: outside })).toBe(false)
    }
  })

  // The parser takes any amount above 0. Jelly's contract cannot say "above 0", so the budgets declare whole cents from
  // $0.01: narrower than the parser, never wider. No default: an unsaved budget is no budget.
  test("declare the budgets in whole cents from $0.01, so every amount Jelly saves is one the parser takes", () => {
    for (const key of ["scriptBudgetUsd", "scriptDailyBudgetUsd"]) {
      const budget = setting(key)
      expect(budget).toMatchObject({ type: "number", min: 0.01, step: 0.01 })
      expect(budget.default).toBeUndefined()
      expect(budget.max).toBeUndefined()
      for (const value of [0.01, 0.07, 1, 2.5, 12.34, 1_000_000]) {
        expect([key, value, settingValueIssue(budget, value)]).toEqual([key, value, null])
        expect([key, value, takes({ [key]: value })]).toEqual([key, value, true])
      }
      for (const value of [0, -1, -0.01]) {
        expect(settingValueIssue(budget, value)).not.toBeNull()
        expect(takes({ [key]: value })).toBe(false)
      }
      // Narrower than the parser: a fraction of a cent the parser would take is never saved by Jelly.
      expect(settingValueIssue(budget, 0.005)).not.toBeNull()
      expect(settingValueIssue(budget, 1.234)).not.toBeNull()
      expect(takes({ [key]: 0.005 })).toBe(true)
      // Unsaved means no budget.
      const parsed = parseOptions({})
      expect(parsed.ok && parsed.options[key as "scriptBudgetUsd" | "scriptDailyBudgetUsd"]).toBeUndefined()
    }
  })
})

describe("docs/jelly.md", () => {
  test("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
