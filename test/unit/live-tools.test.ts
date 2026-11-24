// The declaration against X's tool list as Code Mode's catalogue showed it on 2026-11-14 (`test/fixtures/live-tools.json`,
// with `provenance.json`). The `jelly` declaration enforces its tools without loading the plugin, so every tool X lists is declared,
// and every declared tool is listed or is the plugin's own (`test/fixtures/tool-registry.json`). OpenCode's sign-in to
// X was refused that day, so the list is the catalogue's names and input parameters, with no `readOnlyHint`: each
// `readOnly` is the class in `src/x-tools.ts`. The family kit's drift check reads the same three files and will
// replace this test; a live capture with hints replaces the fixture.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { JELLY_READ_ONLY_OVERRIDES, PARAMETERS, PRIVATE_READ_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS, classify } from "../../src/x-tools.js"

const NAMESPACE = "x"

type Tool = { name: string; permission: string; effect: string; readOnly?: boolean }
type Listed = { name: string; readOnlyHint: boolean | null; inputParams: string[] | null }
type Registry = { own?: string[] }

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as T
const declared = read<{ jelly: { tools: Tool[] } }>("package.json").jelly.tools
const capture = read<{ evidence: string; listedAt: string; server: string; count: number; readOnlyHints: number; tools: Listed[] }>("test/fixtures/live-tools.json")
const provenance = read<{ captures: { fixture: string; evidence: string; listedAt: string; count: number }[]; live: unknown }>("test/fixtures/provenance.json")
const registry = read<Registry>("test/fixtures/tool-registry.json")

const short = (permission: string) => permission.slice(NAMESPACE.length + 1)
const listed = new Map(capture.tools.map((tool) => [tool.name, tool]))
const own = new Set(registry.own ?? [])

describe("the declaration against X's catalogued tool list", () => {
  test("is Code Mode's catalogue of this plugin's server, as provenance.json records it, with no hints", () => {
    expect(capture.server).toBe(NAMESPACE)
    expect(capture.evidence).toBe("catalog")
    expect(capture.count).toBe(capture.tools.length)
    expect(capture.readOnlyHints).toBe(0)
    expect(provenance.captures).toEqual([expect.objectContaining({ fixture: "live-tools.json", evidence: "catalog", listedAt: capture.listedAt, count: capture.count })])
    // No live-observed capture yet: the release gate's freshness check has nothing to read.
    expect(provenance.live).toBeNull()
  })

  test("declares no tool X lacks, except the plugin's own", () => {
    expect(declared.map((tool) => short(tool.permission)).filter((name) => !listed.has(name) && !own.has(name))).toEqual([])
    expect([...own].filter((name) => listed.has(name))).toEqual([])
  })

  test("classifies every listed tool, and declares readOnly from its class except the six restricted reads", () => {
    expect([...listed.keys()].filter((name) => classify(name) === "unknown")).toEqual([])
    // The reads the declaration may run at Read only, and the six privacy-sensitive reads it must ask for and deny.
    const reads = new Set(READ_TOOLS)
    expect(Object.keys(JELLY_READ_ONLY_OVERRIDES).sort()).toEqual([...PRIVATE_READ_TOOLS].sort())
    for (const [name, reason] of Object.entries(JELLY_READ_ONLY_OVERRIDES)) {
      expect({ name, read: reads.has(name), reason: reason.trim().length > 0 }).toEqual({ name, read: false, reason: true })
    }
    for (const tool of declared) {
      const name = short(tool.permission)
      if (own.has(name)) continue
      expect({ tool: tool.permission, readOnly: tool.readOnly ?? false }).toEqual({ tool: tool.permission, readOnly: reads.has(name) })
    }
    // media_upload, the tool added since the 2026-11-06 capture, uploads a file: a write, not a read.
    expect(WRITE_TOOLS).toContain("media_upload")
    expect(PUBLIC_TOOLS).not.toContain("media_upload")
  })

  // The catalogue's parameter names are the signature's bare keys: a quoted key such as "post.fields" is not among them.
  test("records the input parameters the catalogue lists for each tool", () => {
    for (const tool of capture.tools) {
      if (tool.inputParams === null) continue
      const recorded = (PARAMETERS[tool.name] ?? []).map((entry) => entry.split(/[*:]/)[0]!).filter((name) => !name.includes(".")).sort()
      expect({ tool: tool.name, params: recorded }).toEqual({ tool: tool.name, params: [...tool.inputParams].sort() })
    }
  })
})
