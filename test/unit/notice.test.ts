// The release tarball ships NOTICE next to a bundle that inlines third-party code. This test builds the server entry
// with the same options as scripts/build.mjs, collects the packages that actually end up in the bundle (including a
// package inlined by a bundled dist, such as zod inside plugin-contract), and requires each one's licence in NOTICE.
import { describe, expect, test } from "bun:test"
import { build } from "esbuild"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; files: readonly string[] }

/** A package name from an esbuild input path, or undefined for the plugin's own sources. */
function packageOf(path: string): string | undefined {
  const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)
  return match?.[1]
}

function keep(name: string | undefined): name is string {
  return name !== undefined && name !== pkg.name && !name.startsWith("@opencode/") && !name.startsWith(".")
}

/** Every package esbuild actually inlines into the server bundle. */
async function bundledPackages(): Promise<string[]> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(root, "src", "index.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node24",
    external: ["@opencode/*"],
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
  })
  const found = new Set<string>()
  const inputs = Object.keys(result.metafile.inputs)
  for (const path of inputs) {
    const name = packageOf(path)
    if (keep(name)) found.add(name)
  }
  // A bundled dist can inline its own dependencies; plugin-contract's chunks carry the original module path in a
  // comment (`// node_modules/zod/v4/...`). Those packages are redistributed by this bundle too.
  for (const path of inputs) {
    if (!path.startsWith("node_modules/")) continue
    const text = readFileSync(join(root, path), "utf8")
    for (const match of text.matchAll(/\/\/\s*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g)) {
      if (keep(match[1])) found.add(match[1])
    }
  }
  return [...found].sort()
}

function licenceOf(name: string): { readonly version: string; readonly license: string; readonly text: string } {
  const dir = join(root, "node_modules", name)
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string; license?: string }
  const file = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"].find((candidate) => existsSync(join(dir, candidate)))
  if (file === undefined) throw new Error(`${name} ships no licence file`)
  return { version: manifest.version, license: manifest.license ?? "UNKNOWN", text: readFileSync(join(dir, file), "utf8") }
}

describe("the bundled third-party notices", () => {
  test("NOTICE ships in the package", () => {
    expect(pkg.files).toContain("NOTICE")
  })

  test("every bundled package's version, licence and verbatim licence text are in NOTICE", async () => {
    const packages = await bundledPackages()
    expect(packages).toContain("@we-the-rebel-alliance/plugin-contract")
    expect(packages).toContain("yaml")
    expect(packages).toContain("zod")
    const notice = readFileSync(join(root, "NOTICE"), "utf8")
    for (const name of packages) {
      const { version, license, text } = licenceOf(name)
      expect(notice).toContain(`## ${name} ${version} (${license})`)
      expect(notice).toContain(text)
    }
  })
})
