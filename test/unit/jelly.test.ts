import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { ASK_READ_TOOLS, DENY_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"
import { defaultRules, evaluate } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base allow
 * rule, so this plugin's own rules never reach them: Jelly writes each declared "ask" or "deny" as that tool's default.
 */

type Tool = { name: string; permission: string; effect: "allow" | "ask" | "deny"; readOnly: boolean }
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  files: string[]
  jelly: {
    title: string
    summary: string
    icon: string
    tools: Tool[]
    skills: string[]
    rpc: unknown[]
    views: unknown[]
    signIns: unknown[]
    contributes: unknown
  }
}
const { jelly } = pkg
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))

describe("the jelly declaration", () => {
  test("declares every live tool once: reads that run, reads and writes that ask, the public Post, and the off tools", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of ASK_READ_TOOLS) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "ask", readOnly: true })
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS]) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "ask", readOnly: false })
    for (const tool of DENY_TOOLS) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "deny" })
    expect(jelly.tools).toHaveLength(READ_TOOLS.length + ASK_READ_TOOLS.length + WRITE_TOOLS.length + PUBLIC_TOOLS.length + DENY_TOOLS.length)
    expect([...byPermission.keys()].sort()).toEqual([...READ_TOOLS, ...ASK_READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS].map((tool) => `x_${tool}`).sort())
  })

  test("each declared effect is what the plugin's own default rules decide for that tool", () => {
    const rules = [{ action: "*", resource: "*", effect: "allow" as const }, ...defaultRules()]
    for (const tool of jelly.tools) expect([tool.permission, evaluate(rules, tool.permission)]).toEqual([tool.permission, tool.effect])
  })

  test("each tool's name is its Code Mode path, and its permission the host's action", () => {
    for (const tool of jelly.tools) {
      expect(tool.name).toStartWith(`${SERVER_NAME}.`)
      expect(tool.name.replaceAll(".", "_")).toBe(tool.permission)
      expect(Object.keys(tool).sort()).toEqual(["effect", "name", "permission", "readOnly"])
    }
  })

  test("uses only the keys Jelly reads: its contracts strip any other", () => {
    expect(Object.keys(jelly).sort()).toEqual(["contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"])
  })

  test("names every skill the package ships, the one sign-in, and no views, RPC, feeds or widgets", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../../skills", import.meta.url)).sort())
    expect(jelly.skills).toEqual([...SKILL_NAMES])
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [] })
  })

  test("the summary is one line of 1 to 120 characters", () => {
    expect(jelly.summary.trim().length).toBeGreaterThan(0)
    expect(jelly.summary.length).toBeLessThanOrEqual(120)
    expect(jelly.summary).not.toContain("\n")
  })

})
