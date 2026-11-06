// Credentials never reach what status prints: the status RPC, /x-status (posted into the session, so the model
// reads it) and the dialog. Every shape is checked on all three. Ported from opencode-wisprflow's redact tests.
import { describe, expect, test } from "bun:test"
import { ENDPOINT } from "../../src/constants.js"
import { checkHost } from "../../src/host-version.js"
import { registerServer } from "../../src/plugin.js"
import { parseOptions } from "../../src/options.js"
import { serverConfig } from "../../src/server.js"
import { reasonOf, shortReason } from "../../src/redact.js"
import { buildStatus, formatStatus, registerStatusCommand, registerStatusRpc, type ServerSource, type Status, type StatusFacts } from "../../src/status.js"
import { viewMessage } from "../../src/tui.js"
import { mcpEditor, transforms, type McpEditor } from "./fake.js"

const SECRETS = ["hunter2", "abcdefghijklmnop", "sk-live-0123456789abcdef", "eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl", "secret-path-123", "fake-signature", "x".repeat(48)]
const host = checkHost("2.2.3", false)
const plugin: ServerSource = { type: "plugin", url: ENDPOINT, signIn: "oauth" }
const parsed = parseOptions({ oauth: { client_id: "client-1" } })
if (!parsed.ok) throw new Error(parsed.error.message)
const options = parsed.options

/** The three surfaces that show a status: the RPC's output, the session text and the dialog's text. */
async function surfaces(status: Status) {
  let rpc: unknown
  await registerStatusRpc(
    {
      register: async (_definition, handlers) =>
        ((rpc = await handlers.status({} as never, { error: () => undefined } as never)), { dispose: async () => {}, events: { emit: async () => {} } }) as never,
    },
    async () => status,
  )
  let posted = ""
  let execute: ((input: { sessionID: string }) => Promise<void>) | undefined
  await registerStatusCommand(
    {
      command: { transform: async (callback) => (callback({ add: (definition) => void (execute = definition.execute as never) }), { dispose: async () => {} }) },
      session: { synthetic: async (input) => ((posted = (input as { text: string }).text), {}) as never },
    },
    async () => status,
  )
  await execute!({ sessionID: "ses_1" })
  return [JSON.stringify(rpc), posted, viewMessage({ status })]
}

async function expectClean(facts: StatusFacts) {
  const texts = await surfaces(buildStatus(facts))
  expect(texts.every((text) => text.length > 0)).toBe(true)
  for (const text of texts) for (const secret of SECRETS) expect({ secret, leaked: text.includes(secret) }).toEqual({ secret, leaked: false })
}

describe("redaction", () => {
  test.each([
    ["URL credentials", "fetch https://alice:hunter2@api.x.com/mcp/v1 failed"],
    ["a bearer token", "401 Authorization: Bearer abcdefghijklmnop rejected"],
    ["a key=value secret", "refused: api_key=hunter2 and token: abcdefghijklmnop"],
    ["a vendor key", "invalid key sk-live-0123456789abcdef"],
    ["a JWT", "expired eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl"],
    ["a signed URL", "GET https://files.x.example/a.png?signature=fake-signature failed"],
    ["a long key run", `bad ${"x".repeat(48)}`],
  ])("a failure's reason with %s never shows it", async (_, error) => {
    await expectClean({ server: { status: "failed", error }, source: plugin, host })
  })

  test("a conflicting server at another origin shows only its origin, on every surface", async () => {
    const records: (ServerSource | undefined)[] = []
    const { transform, run } = transforms<McpEditor>()
    await registerServer({ transform }, () => serverConfig(options, { id: "client-1", source: "options" }, ENDPOINT), (source) => void records.push(source))
    run(mcpEditor({ x: { type: "remote", url: "https://alice:hunter2@hooks.example.com/s/secret-path-123/mcp" } }).editor)
    expect(records[0]).toEqual({ type: "conflict", url: "https://hooks.example.com/…", expected: ENDPOINT })
    const status = buildStatus({ server: { status: "connected" }, source: records[0]!, host })
    expect(status.nextStep).toContain("mcp.servers.x with https://hooks.example.com/…")
    await expectClean({ server: { status: "connected" }, source: records[0]!, host })
  })

  test("a conflict at X's own origin keeps its path, without credentials or query", () => {
    const records: (ServerSource | undefined)[] = []
    const { transform, run } = transforms<McpEditor>()
    void registerServer({ transform }, () => serverConfig(options, { id: "client-1", source: "options" }, ENDPOINT), (source) => void records.push(source))
    run(mcpEditor({ x: { type: "remote", url: "https://alice:hunter2@api.x.com/mcp/v2?token=abcdefghijklmnop" } }).editor)
    expect(records[0]).toEqual({ type: "conflict", url: "https://api.x.com/mcp/v2", expected: ENDPOINT })
  })

  test("setup problems carry the error's short, redacted message on one line", async () => {
    const reason = reasonOf(new Error("boom\n  at https://alice:hunter2@example.com/x?token=abcdefghijklmnop\n  Bearer abcdefghijklmnop"))
    expect(reason).toBe("boom at https://example.com/x Bearer [redacted]")
    expect(reasonOf("")).toBe("no reason given")
    await expectClean({ server: { status: "connected" }, source: plugin, host, tools: ["search_posts_all"], problems: [`RULES_NOT_ADDED: could not be added (${reason}). Next step: Restart OpenCode.`] })
  })

  test("the cut keeps whole characters and stays at 160", () => {
    const cut = shortReason(`${"a ".repeat(79)}😀😀😀`)!
    expect(Array.from(cut)).toHaveLength(160)
    expect(cut.endsWith("…")).toBe(true)
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(shortReason("short 😀")).toBe("short 😀")
  })

  test("C1 controls and bidi characters never reach a reason, the dialog's error or the Account row", () => {
    expect(shortReason("a\u0085b\u009bc‮evil⁦x⁩")).toBe("a b cevilx")
    expect(viewMessage({ error: new Error(`refused\nBearer abcdefghijklmnop ${"z".repeat(300)}`) })).not.toMatch(/\n.*Bearer|abcdefghijklmnop|z{200}/s)
    const status = buildStatus({ server: { status: "connected" }, source: plugin, host, account: `Example‮evil\u0085 Recruiter\n${"y".repeat(200)}` })
    expect(status.account).toMatch(/^Exampleevil Recruiter y+…$/)
    expect(Array.from(status.account!)).toHaveLength(80)
    expect(formatStatus(status)).toContain(`- Account: ${status.account}\n`)
  })

  test("the formatted text and the model agree: no surface adds its own unredacted copy", () => {
    const status = buildStatus({ server: { status: "failed", error: "Bearer abcdefghijklmnop" }, source: plugin, host })
    expect(status.error).toBe("Bearer [redacted]")
    expect(formatStatus(status)).toContain("- Connection: failed (Bearer [redacted]")
  })
})
