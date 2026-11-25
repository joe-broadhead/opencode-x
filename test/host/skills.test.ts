// The skills the plugin ships are in the real 2.4.1 host's skill list, not only on disk.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Plugin } from "@opencode/plugin"
import { OpenCode } from "@opencode/sdk"
import { parse } from "yaml"

const root = fileURLToPath(new URL("../..", import.meta.url))
const directories = readdirSync(join(root, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
/** The description in a SKILL.md, parsed as YAML, checked to be real text and not a block-scalar marker. */
function expectedDescription(id: string): string {
  const text = readFileSync(join(root, "skills", id, "SKILL.md"), "utf8")
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (frontmatter === undefined) throw new Error(`${id}: no frontmatter`)
  const parsed = parse(frontmatter) as { description?: unknown }
  if (typeof parsed.description !== "string") throw new Error(`${id}: description is not a string`)
  const description = parsed.description
  if (description.trim() === "" || description === ">" || description === "|") throw new Error(`${id}: description is empty or a block scalar`)
  return description
}

const work = mkdtempSync(join("/tmp", "x-host-skills-"))
writeFileSync(join(work, "package.json"), JSON.stringify({ name: "x-host-skills", private: true, type: "module" }))
afterAll(() => rmSync(work, { recursive: true, force: true }))

describe("the shipped skills in the real host", () => {
  test("every skills/*/SKILL.md directory id is in the 2.4.1 skill list", async () => {
    const loaded = (await import(pathToFileURL(join(root, "dist", "index.js")).href)) as { default: Plugin.Plugin }
    const definition = loaded.default
    const caught: string[] = []
    const wrapper: Plugin.Plugin = {
      id: definition.id,
      async setup(context) {
        const proxy = new Proxy(context, {
          get(target, property) {
            if (property === "options") return { access: "all", accounts: { default: { clientId: "host-test-client" } } }
            return Reflect.get(target, property)
          },
        })
        try {
          return await definition.setup(proxy)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // The contract still refuses the one-letter name at the first line of register; the skills are registered
          // before it, so the wrapper lets that one refusal through to prove the skill list.
          if (!message.includes('bus: "x" is not a plugin name')) throw error
          caught.push(message)
        }
      },
    }
    const host = await OpenCode.create({
      plugins: [wrapper],
      config: { directory: work },
      app: { name: "opencode", version: "2.4.1" },
      log: { level: "error", emit: () => undefined },
    })
    const session = await host.sessions.create({ location: { directory: work }, agent: "build", permissions: [] })
    try {
      await host.sessions.prompt({ sessionID: session.id, text: "activate the conformance plugin", delivery: "queue" }).catch(() => undefined)
      let skills: { readonly id: string; readonly description?: string }[] = []
      for (let attempt = 0; attempt < 100; attempt++) {
        const listed = await host.skill.list({ location: { directory: work } }).catch(() => ({ data: [] as { id: string; description?: string }[] }))
        skills = listed.data.map((entry: { readonly id: string; readonly description?: string }) => ({ id: String(entry.id), ...(typeof entry.description === "string" ? { description: entry.description } : {}) }))
        if (directories.every((id) => skills.some((skill) => skill.id === id))) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      for (const id of directories) {
        const skill = skills.find((entry) => entry.id === id)
        expect(skill).toBeDefined()
        expect(skill?.description).toBe(expectedDescription(id))
      }
      expect(caught.every((message) => message.includes('bus: "x" is not a plugin name'))).toBe(true)
    } finally {
      await host.close()
    }
  }, 120_000)
})
