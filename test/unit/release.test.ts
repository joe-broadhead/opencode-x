// The release workflow publishes exactly the three files a consumer pins; a bare release/* glob would upload a
// directory (release/dist) and fail the whole release, as it did for colab.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const root = new URL("../../", import.meta.url)
const workflow = readFileSync(new URL(".github/workflows/release.yml", root), "utf8")

describe("the release workflow", () => {
  test("publishes exactly the package, the conformance report and the checksums", () => {
    const create = workflow.split("\n").find((line) => line.includes("gh release create"))
    expect(create).toBeDefined()
    expect(create).toContain("release/*.tgz")
    expect(create).toContain("release/conformance.json")
    expect(create).toContain("release/SHA256SUMS")
    for (const line of workflow.split("\n")) expect(line).not.toMatch(/release\/\*(?!\.tgz)/)
  })
})
