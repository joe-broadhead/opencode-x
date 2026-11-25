// The skills the plugin ships: each directory parses, and a broken file is a status problem rather than a skill.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadSkills, SKILLS_DIR } from "../../src/skills.js"

const made: string[] = []
const fresh = () => {
  const directory = mkdtempSync(join("/tmp", "x-skills-"))
  made.push(directory)
  return directory
}
afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true })
})

const skill = (name: string) => ["---", `name: ${name}`, "description: An invented skill for this test.", "---", `# ${name}`, "Body."].join("\n")

describe("the shipped skills", () => {
  test("every skills directory parses, with a description and content", async () => {
    const loaded = await loadSkills(SKILLS_DIR)
    expect(loaded.problems).toEqual([])
    expect(loaded.skills.map((entry) => String(entry.id)).sort()).toEqual(["x", "x-write"])
    for (const entry of loaded.skills) {
      expect((entry.description ?? "").length).toBeGreaterThan(0)
      expect(entry.content.length).toBeGreaterThan(0)
    }
  })

  test("a broken skill file is a problem and is not registered", async () => {
    const directory = fresh()
    const cases: Record<string, string> = {
      wrongname: skill("other"),
      nodescription: ["---", "name: nodescription", "---", "Body."].join("\n"),
      empty: ["---", "name: empty", "description: An invented skill for this test.", "---", "  "].join("\n"),
      nofrontmatter: "# No frontmatter",
    }
    for (const [name, text] of Object.entries(cases)) {
      mkdirSync(join(directory, name))
      writeFileSync(join(directory, name, "SKILL.md"), text)
    }
    const loaded = await loadSkills(directory)
    expect(loaded.skills).toEqual([])
    expect(loaded.problems).toHaveLength(Object.keys(cases).length)
    for (const problem of loaded.problems) expect(problem).toContain("was not loaded")
  })

  test("a directory without SKILL.md is a problem", async () => {
    const directory = fresh()
    mkdirSync(join(directory, "missing"))
    const loaded = await loadSkills(directory)
    expect(loaded.skills).toEqual([])
    expect(loaded.problems).toEqual([`The "missing" skill was not loaded: skills/missing/SKILL.md is missing. Reinstall the plugin.`])
  })
})
