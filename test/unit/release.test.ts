// The release workflow publishes exactly the three files a consumer pins; a bare release/* glob would upload a
// directory (release/dist) and fail the whole release, as it did for colab.
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = new URL("../../", import.meta.url)
const workflow = readFileSync(new URL(".github/workflows/release.yml", root), "utf8")

// The lines of one step, from its `- name:` to the next step.
function step(name: string): string[] {
  const lines = workflow.split("\n")
  const start = lines.findIndex((line) => line === `      - name: ${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^ {6}- /.test(line)) break
    block.push(line)
  }
  return block
}

function runBlock(block: string[]): { readonly cwd?: string; readonly command: string } {
  const directory = block.find((line) => line.trim().startsWith("working-directory:"))
  const run = block.find((line) => line.trim().startsWith("run:"))
  if (run === undefined) throw new Error("the step has no run")
  return {
    cwd: directory?.trim().slice("working-directory:".length).trim(),
    command: run.trim().slice("run:".length).trim(),
  }
}

describe("the release workflow", () => {
  test("publishes exactly the package, the conformance report and the checksums", () => {
    const create = workflow.split("\n").find((line) => line.includes("gh release create"))
    expect(create).toBeDefined()
    expect(create).toContain("release/*.tgz")
    expect(create).toContain("release/conformance.json")
    expect(create).toContain("release/SHA256SUMS")
    for (const line of workflow.split("\n")) expect(line).not.toMatch(/release\/\*(?!\.tgz)/)
  })

  test("the build writes the sums exactly as the template does", () => {
    expect(step("Pack the release files").join("\n")).toContain(
      "sha256sum release/*.tgz release/conformance.json > release/SHA256SUMS",
    )
  })

  // The sums hold repository-root paths. Checking them from release/ looks for release/release/<file> and fails the
  // publish job after a tag is already cut; this runs the workflow's own step against a release/ tree.
  test("the publish check verifies the sums from the repository root", () => {
    const { cwd, command } = runBlock(step("Check the files against SHA256SUMS"))
    const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "x-release-sums-")))
    try {
      mkdirSync(join(work, "release"))
      writeFileSync(join(work, "release", "we-the-rebel-alliance-x-plugin-0.0.0.tgz"), "tarball")
      writeFileSync(join(work, "release", "conformance.json"), "{}\n")
      const sums = spawnSync("bash", ["-c", "sha256sum release/*.tgz release/conformance.json > release/SHA256SUMS"], {
        cwd: work,
        encoding: "utf8",
      })
      expect(sums.status).toBe(0)
      const check = spawnSync("bash", ["-c", command], { cwd: cwd === undefined ? work : join(work, cwd), encoding: "utf8" })
      expect(check.stderr).toBe("")
      expect(check.status).toBe(0)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
    expect(cwd).toBeUndefined()
    expect(command).toBe("sha256sum -c release/SHA256SUMS")
  })
})
