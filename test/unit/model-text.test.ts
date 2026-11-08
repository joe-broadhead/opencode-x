// R18: what the model reads says what the default does. Every known tool is allowed under `access: "all"`, on the
// user's own real X account, so no text the model sees may say a tool asks first, is read-only, needs an option turned
// on, or is off until it is classified. A sentence that names `ask-changes` or `read-only` describes that value, not
// the default, so it is not a claim about `all`.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { NAMESPACE_DESCRIPTION } from "../../src/constants.js"
import { formatStatus, type Status } from "../../src/status.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

/** A claim that is false under the default block: a tool cannot ask, be refused or be off, because every tool allows. */
const STALE: [string, RegExp][] = [
  // Case-sensitive "asks": the imperative "Ask the user before …" is guidance to the model, not a claim about a rule.
  ["says a tool asks first", /\basks (?:the user )?(?:first|before)\b/],
  ["needs an option turned on", /\bneeds? (?:the (?:plugin )?)?option\b/i],
  ["is off until classified", /\b(?:off|asks?) until (?:it is |they are )?classif/i],
  ["says it is read-only now", /\bread-only now\b/i],
  ["is refused while read-only", /\brefused while (?:the plugin is )?read-only\b/i],
  ["says no tool changes anything", /\bno tool (?:here )?changes\b/i],
  ["says the writes are off", /\b(?:the )?(?:private )?writes? (?:are|stay) off\b/i],
]

/** A sentence that names a restricting value describes that value, not the default. */
const atAll = (text: string) =>
  text
    .split(/(?<=[.:])\s+/)
    .filter((sentence) => !/(?:ask-changes|read-only)/.test(sentence))
    .join(" ")

const jellySummary = () => (JSON.parse(read("package.json")) as { jelly?: { summary?: string } }).jelly?.summary ?? ""

/** The status a person reads with the default option and the block in place. */
const defaultStatus = (): Status =>
  ({
    version: "0.0.0",
    state: "connected",
    access: "all",
    host: { version: "2.2.6", range: ">=2.2.3 <2.3.0", tested: true },
    tools: [],
    unknownCount: 1,
    unknownTools: ["shiny_new_tool"],
    deniedCount: 0,
    deniedTools: [],
    unguardedAgents: [],
    problems: [],
    nextStep: "Nothing to do.",
  }) as unknown as Status

describe("the model-facing text at access all", () => {
  const all = {
    "the Code Mode namespace": NAMESPACE_DESCRIPTION,
    "the Jelly summary": jellySummary(),
    "the /x-status text": formatStatus(defaultStatus()),
    ...Object.fromEntries(readdirSync(join(ROOT, "skills")).map((name) => [`skills/${name}/SKILL.md`, read(`skills/${name}/SKILL.md`)] as const)),
  }

  test.each(Object.entries(all))("%s claims nothing the default block contradicts", (_file, text) => {
    for (const [claim, pattern] of STALE) expect({ claim, hit: pattern.exec(atAll(text))?.[0] ?? null }).toEqual({ claim, hit: null })
  })

  test("the namespace says what the default does on the user's real account, and that access restricts it", () => {
    expect(NAMESPACE_DESCRIPTION).toContain("with all (the default) they run without a prompt")
    expect(NAMESPACE_DESCRIPTION).toContain("on the user's own real X account")
    expect(NAMESPACE_DESCRIPTION).toContain("with ask-changes they ask")
    expect(NAMESPACE_DESCRIPTION).toContain("with read-only they are denied")
  })

  test("status says every tool is allowed, and that an unknown tool runs too", () => {
    const text = formatStatus(defaultStatus())
    expect(text).toContain("every X tool is allowed by default, writes included")
    expect(text).toContain("unknown tools run without asking")
  })
})
