// R1: every scripting example is runnable as written: a known method, its own schema, and the header and envelope.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { METHODS } from "../../src/host/tools-rpc.js"
import { PARAMETERS } from "../../src/x-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const NAMES = new Set(METHODS.map((method) => method.name))

/**
 * The tool's recorded parameters, from X's own schema: the keys it has, and which of them are required. An example
 * that names a field X does not have, or leaves out a required one, would be refused by X as written.
 */
function toolSchema(method: string) {
  const entries = PARAMETERS[method] ?? []
  const name = (entry: string) => entry.replace(/\*?:.*$/, "")
  return {
    keys: new Set(entries.map(name)),
    required: entries.filter((entry) => entry.includes("*:")).map(name),
  }
}

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
        const body = payload(command) as { input?: Record<string, unknown> }
        if (method === "describe") {
          expect(body).toHaveProperty("input")
          continue
        }
        const envelope = body.input as { sessionID?: unknown; input?: Record<string, unknown> }
        expect(typeof envelope.sessionID).toBe("string")
        // R1: the tool's input is the tool's own, so its keys come from X's schema.
        const example = envelope.input as Record<string, unknown>
        const { keys, required } = toolSchema(method!)
        expect({ method, unknown: Object.keys(example).filter((key) => !keys.has(key)) }).toEqual({ method, unknown: [] })
        expect({ method, missing: required.filter((key) => !(key in example)) }).toEqual({ method, missing: [] })
      }
    })
  }
})
