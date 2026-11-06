// The drift script against the live tool list captured on 2026-11-06: the recorded list must be clean, and an edited
// copy must show the change. It reads files only.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { classify, DENY_TOOLS, PARAMETERS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"

const SCRIPT = fileURLToPath(new URL("../../scripts/check-x-tools.mjs", import.meta.url))
const FIXTURE = fileURLToPath(new URL("./x-live-tools.json", import.meta.url))
const dir = mkdtempSync(join(tmpdir(), "x-drift-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS]
type LiveTool = { name: string; description?: string; inputSchema?: unknown; annotations?: Record<string, boolean> }
const live = () => JSON.parse(readFileSync(FIXTURE, "utf8")) as { tools: LiveTool[] }

let files = 0
function drift(list: unknown, args: string[] = []) {
  const file = join(dir, `tools-${++files}.json`)
  writeFileSync(file, JSON.stringify(list))
  const result = spawnSync("node", [SCRIPT, file, ...args], { encoding: "utf8" })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

describe("npm run drift", () => {
  test("PARAMETERS records every live tool, each entry a name, required mark and type", () => {
    expect(Object.keys(PARAMETERS).sort()).toEqual([...ALL].sort())
    for (const entries of Object.values(PARAMETERS)) for (const entry of entries) expect(entry).toMatch(/^[a-z][a-zA-Z0-9_.]*\*?:[a-z<>|]+$/)
  })

  test("the captured live list is clean against the record", () => {
    expect(live().tools).toHaveLength(100)
    const { code, out } = drift({ tools: live().tools }, ["--strict"])
    expect(code).toBe(0)
    expect(out.trim().split("\n").at(-1)).toBe("No drift.")
  })

  test("a changed input is drift: a new type or a required mark", () => {
    const tools = structuredClone(live().tools)
    const search = tools.find((tool) => tool.name === "search_posts_all")!
    ;(search.inputSchema as { properties: Record<string, { type?: string }> }).properties.max_results = { type: "string" }
    const { code, out } = drift({ tools }, ["--strict"])
    expect(code).toBe(1)
    expect(out).toContain("search_posts_all: max_results (integer -> string)")
  })

  test("an added tool is drift; a removed tool alone is information", () => {
    const tools = [...structuredClone(live().tools), { name: "shiny_new_tool", description: "A tool added later.", inputSchema: { type: "object", properties: { query: { type: "string" } } } }]
    const added = drift({ tools }, ["--strict"])
    expect(added.code).toBe(1)
    expect(added.out).toContain("Added: listed by X, in no list of src/x-tools.ts:\n  shiny_new_tool")
    const removed = drift({ tools: live().tools.filter((tool) => tool.name !== "get_news") }, ["--strict"])
    expect(removed.code).toBe(0)
    expect(removed.out).toContain("No drift apart from the removed tools above.")
  })

  test("an annotation that contradicts a read is drift when the list carries annotations", () => {
    const tools = structuredClone(live().tools).map((tool) => ({ ...tool, annotations: { readOnlyHint: classify(tool.name) === "read", destructiveHint: false } }))
    tools.find((tool) => tool.name === "get_users_me")!.annotations = { readOnlyHint: false, destructiveHint: false }
    const { code, out } = drift({ tools }, ["--strict"])
    expect(code).toBe(1)
    expect(out).toContain("Reclassified: the lists disagree with X's annotations:\n  get_users_me  readOnlyHint=false destructiveHint=false")
  })

  test("refuses a file that is not a tool list, and a missing argument, with exit code 2", () => {
    expect(drift({ servers: [] }).code).toBe(2)
    const none = spawnSync("node", [SCRIPT], { encoding: "utf8" })
    expect(none.status).toBe(2)
    expect(none.stderr).toContain("no tool list given")
  })
})
