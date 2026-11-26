// The shipped skills parse as YAML frontmatter and register their real text.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readSkills } from "../../src/skills.js"

const made: string[] = []
const fresh = () => {
  const directory = mkdtempSync(join("/tmp", "x-skills-"))
  made.push(directory)
  return directory
}
afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true })
})

describe("the shipped skills", () => {
  test("every skills directory parses, with a YAML description and content", () => {
    const skills = readSkills()
    expect(skills.map((entry) => entry.id).sort()).toEqual(["x", "x-write"])
    for (const entry of skills) {
      expect(entry.name).toBe(entry.id)
      expect(entry.description.trim().length).toBeGreaterThan(0)
      expect([" >", ">", "|", ">-", "|-"].includes(entry.description.trim())).toBe(false)
      expect(entry.content.trim().length).toBeGreaterThan(0)
    }
  })

  test("a broken skill file throws with the contract code", () => {
    const directory = fresh()
    mkdirSync(join(directory, "broken"))
    writeFileSync(join(directory, "broken", "SKILL.md"), ["---", "name: other", "description: An invented skill for this test.", "---", "Body."].join("\n"))
    expect(() => readSkills(directory)).toThrow(/^SCHEMA_VIOLATION: /)
  })

  test("a block-scalar description registers its text, not the marker", () => {
    const directory = fresh()
    mkdirSync(join(directory, "block"))
    writeFileSync(join(directory, "block", "SKILL.md"), ["---", "name: block", "description: >", "  A folded description", "  on two lines.", "---", "Body."].join("\n"))
    const [skill] = readSkills(directory)
    expect(skill?.description.trim()).toBe("A folded description on two lines.")
  })
})
