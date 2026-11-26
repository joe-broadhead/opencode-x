// Pack, install and start: the tarball holds exactly the package's files, and the installed package loads in the real
// embedded OpenCode 2.4.1 host with its three methods, its namespace and its one RPC id.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { createHost } from "@we-the-rebel-alliance/plugin-contract/kit"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; files: string[] }
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "x-pack-")))
afterAll(() => rmSync(work, { recursive: true, force: true }), { timeout: 120_000 })

type Packed = { filename: string; size: number; entryCount: number; files: { path: string }[] }

let packed: Packed | undefined
function pack(): Packed {
  if (packed) return packed
  run("npm", ["run", "bundle"], root)
  const output = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root)
  packed = (JSON.parse(output) as Packed[])[0]!
  return packed
}

const run = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = { ...process.env, npm_config_update_notifier: "false" }) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

const tree = (directory: string, base = directory): string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name !== ".DS_Store")
    .map((item) => relative(base, join(item.parentPath, item.name)).split(sep).join("/"))

describe("package tarball", () => {
  test("lists exactly the files whitelist and stays small", () => {
    const held = pack()
    const listed = held.files.map((file) => file.path).sort()
    const expected = ["package.json", ...pkg.files.flatMap((entry) => {
      const path = join(root, entry)
      return statSync(path).isDirectory() ? tree(path, root) : [entry]
    })].sort()
    expect(listed).toEqual(expected)
    expect(held.entryCount).toBeLessThan(20)
    expect(held.size).toBeLessThan(2 * 1024 * 1024)
  }, 120_000)

  test("installs and starts the tarball in the real 2.4.1 host", async () => {
    const tarball = join(work, pack().filename)
    const project = join(work, "project")
    mkdirSync(project)
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "x-pack-project", private: true, type: "module" }))
    run("npm", ["install", tarball, "@opencode/plugin@2.4.1", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], project)
    const installed = join(project, "node_modules", ...pkg.name.split("/"))
    const host = await createHost({ directory: installed, version: "2.4.1", pluginId: "x", options: { access: "all" } })
    try {
      expect(host.failure).toBeUndefined()
      expect(host.refusal).toBeUndefined()
      expect(host.definition?.id).toBe("x")
      expect(host.namespace).toEqual({ name: "x", description: expect.any(String) })
      expect(host.tools.map((tool) => tool.permission).sort()).toEqual(["x.events_list", "x.probe", "x.status"])
      expect(host.rpc?.id).toBe("x")
      expect([...(host.rpc?.methods ?? [])].sort()).toEqual(["events_list", "probe", "status"])
      expect(host.rpc?.events).toEqual([])
    } finally {
      await host.close()
    }
  }, 600_000)
})
