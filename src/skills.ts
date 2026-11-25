// The skills the plugin ships: read and validated before the synchronous transform runs, then added to the host's
// skill list. A broken file is a status problem, never a registered skill: the plugin still serves its tools.
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"

/** `skills/` at the package root, next to `dist/` (and next to `src/` in the repository). */
export const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url))

/** A skill file that cannot be registered, in the one sentence status shows. */
class SkillError extends Error {}

const notLoaded = (name: string, problem: string) => `The "${name}" skill was not loaded: skills/${name}/SKILL.md ${problem}. Reinstall the plugin.`

/** Parses `---` frontmatter with `name` and `description`; the body after it is the skill's content. */
export function parseSkill(name: string, path: string, text: string): Skill.Info {
  const fail = (problem: string): never => {
    throw new SkillError(notLoaded(name, problem))
  }
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (!match) return fail("has no frontmatter")
  const fields = new Map(
    match[1]!
      .split("\n")
      .flatMap((line) => {
        const at = line.indexOf(":")
        if (at <= 0) return []
        return [[line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, "$2")] as const]
      }),
  )
  if (fields.get("name") !== name) return fail(`must be named "${name}" in its frontmatter`)
  const description = fields.get("description") ?? ""
  if (description === "") return fail("has no description")
  if (description === ">" || description === "|") return fail("has a block-scalar description; write the description on one line")
  const content = match[2]!.trim()
  if (content === "") return fail("has no content")
  return {
    id: Skill.ID.make(name),
    name: Skill.Name.make(name),
    description,
    path: Skill.Info.fields.path.make(path),
    content,
  }
}

/**
 * Reads every `skills/<name>/SKILL.md`. A missing or broken file does not stop the plugin, because the tools and the
 * permission rules still work; it is reported as a problem in status instead.
 */
export async function loadSkills(directory = SKILLS_DIR): Promise<{ readonly skills: readonly Skill.Info[]; readonly problems: readonly string[] }> {
  const skills: Skill.Info[] = []
  const problems: string[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return { skills, problems: [`The skills directory could not be read: ${directory}. Reinstall the plugin.`] }
  }
  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const name = entry.name
    const path = join(directory, name, "SKILL.md")
    try {
      skills.push(parseSkill(name, path, await readFile(path, "utf8")))
    } catch (error) {
      const code = (error as { code?: unknown }).code
      problems.push(error instanceof SkillError ? error.message : notLoaded(name, code === "ENOENT" ? "is missing" : "cannot be read"))
    }
  }
  return { skills, problems }
}

/** Registers the loaded skills; the host replays the transform on every rebuild. */
export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform((editor) => {
    for (const info of skills) editor.add(info)
  })
}
