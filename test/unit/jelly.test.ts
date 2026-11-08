import { describe, expect, test } from "bun:test"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { DENY_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"
import { defaultRules, evaluate } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, readPackage } from "../support/jelly-kit.js"

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
const known = [...READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS].map((tool) => `${SERVER_NAME}_${tool}`)

describe("the jelly declaration", () => {
  test("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: (permission) => evaluate([BASE_ALLOW, ...defaultRules()], permission), registered: known })).toEqual([])
  })

  test("declares every live tool once: reads that run, reads and writes that ask, the public Post, and the off tools", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS]) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "allow", readOnly: false })
    for (const tool of DENY_TOOLS) expect(byPermission.get(`x_${tool}`)).toMatchObject({ effect: "allow" })
    expect(jelly.tools).toHaveLength(known.length)
    for (const tool of jelly.tools) expect(Object.keys(tool).sort()).toEqual(["effect", "name", "permission", "readOnly"])
  })

  test("names every skill the package ships, the one sign-in, and no views, RPC, feeds or widgets", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect(jelly.skills).toEqual([...SKILL_NAMES])
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [] })
  })
})

describe("docs/jelly.md", () => {
  test("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
