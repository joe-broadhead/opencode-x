// Docs and install paths: every install example names the package's own release tag, every generated section has its
// markers, and the fixed-context budget holds.
import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { manifest } from "../../src/manifest.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }
const read = (path: string) => readFileSync(join(root, path), "utf8")

const DOC_FILES = ["README.md", "docs/capabilities.md", "docs/configuration.md", "docs/accounts.md", "docs/automations.md"]
const INSTALL_FILES = ["README.md", "CONTRIBUTING.md", "docs/configuration.md", "docs/accounts.md", "AGENTS.md"]

/** Every markdown file in the repository's docs and skills, and the root files that carry install lines. */
function markdown(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) markdown(path, found)
    else if (entry.endsWith(".md")) found.push(path)
  }
  return found
}

describe("install paths", () => {
  test("every install example names the package's release tag", () => {
    const tag = `#v${pkg.version}`
    for (const file of INSTALL_FILES) {
      const text = read(file)
      for (const match of text.matchAll(/github:we-the-rebel-alliance\/x-plugin(#[\w./-]+)?/g)) {
        expect(`${file}: ${match[0]}`).toBe(`${file}: github:we-the-rebel-alliance/x-plugin${tag}`)
      }
      for (const line of text.split("\n")) {
        if (!/opencode plugin add/.test(line)) continue
        expect(`${file}: ${line.trim()}`).toContain(`github:we-the-rebel-alliance/x-plugin${tag}`)
      }
      expect(text).not.toMatch(/x-plugin#master/)
    }
  })

})

describe("generated sections", () => {
  test("every shipped doc file carries the markers the kit writes", () => {
    const sections: Record<string, string[]> = {
      "README.md": ["capabilities", "errors"],
      "docs/capabilities.md": ["capabilities"],
      "docs/configuration.md": ["configuration"],
      "docs/accounts.md": ["accounts"],
      "docs/automations.md": ["automations"],
    }
    for (const file of DOC_FILES) {
      const text = read(file)
      for (const section of sections[file]!) {
        expect(`${file}: ${text.includes(`<!-- generated:${section} -->`) && text.includes(`<!-- /generated:${section} -->`)}`).toBe(`${file}: true`)
      }
    }
  })

  test("the changelog has the release section", () => {
    expect(read("CHANGELOG.md")).toContain("## 0.0.0 (2026-11-25)")
  })
})

describe("fixed context", () => {
  test("the namespace line is at most 400 characters and one line", () => {
    expect(manifest.plugin.summary.length).toBeLessThanOrEqual(400)
    expect(manifest.plugin.summary).not.toMatch(/[\r\n]/)
  })

  test("each skill is in the plugin's namespace with a description of at most 300 characters", () => {
    const skills = markdown(join(root, "skills"))
    expect(skills.length).toBeGreaterThan(0)
    for (const file of skills) {
      const text = readFileSync(file, "utf8")
      const front = /^---\n([^]*?)\n---/.exec(text)?.[1] ?? ""
      const name = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim()
      const description = /^description:\s*"?([^"\n]+)"?\s*$/m.exec(front)?.[1]?.trim() ?? ""
      expect(`${file}: ${name === "x" || name?.startsWith("x-")}`).toBe(`${file}: true`)
      expect(`${file}: ${description.length <= 300}`).toBe(`${file}: true`)
    }
  })
})
