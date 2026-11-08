// R1: every scripting example is runnable as written: a known method, the location header, and the envelope.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { METHODS } from "../../src/host/tools-rpc.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const NAMES = new Set(METHODS.map((method) => method.name))

/** `opencode api` commands, with a trailing backslash joined to the next line. */
function commands(text: string) {
  const lines = text.split("\n")
  const found: string[] = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index]!.trimStart().startsWith("opencode api post /api/rpc/")) continue
    let command = lines[index]!
    while ((!command.includes("-d '") || !command.trimEnd().endsWith("'")) && index + 1 < lines.length) {
      command = `${command.trimEnd().replace(/\\$/, "")} ${lines[++index]!.trim()}`
    }
    found.push(command)
  }
  return found
}

const payload = (command: string) => {
  const match = /-d '([\s\S]*)'/.exec(command)
  expect(match, command).not.toBeNull()
  return JSON.parse(match![1]!)
}

describe("the scripting examples", () => {
  for (const file of ["docs/scripting.md", "README.md"]) {
    test(`${file} names known methods and carries the header and envelope`, () => {
      const found = commands(readFileSync(join(ROOT, file), "utf8"))
      expect(found.length).toBeGreaterThan(0)
      for (const command of found) {
        if (command.includes("/<method>")) continue
        expect(command).toContain('-H "x-opencode-directory:$PWD"')
        const method = /\/api\/rpc\/x\.posts\.tools\/([a-z_]+)/.exec(command)?.[1]
        expect(method).toBeDefined()
        expect(method === "describe" || NAMES.has(method!)).toBe(true)
        const input = payload(command)
        if (method === "describe") {
          expect(input).toHaveProperty("input")
          continue
        }
        expect(input).toHaveProperty("input.sessionID")
        expect(typeof input.input).toBe("object")
      }
    })
  }
})
