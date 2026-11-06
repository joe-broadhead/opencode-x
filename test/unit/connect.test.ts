import { describe, expect, test } from "bun:test"
import { APP_NAME, registerAppIntegration, resolveClient, sameClient, type ClientState } from "../../src/connect.js"
import { REDIRECT_URI, SCOPES } from "../../src/constants.js"
import { parseOptions } from "../../src/options.js"
import { clientMode, serverConfig } from "../../src/server.js"

const options = (oauth: Record<string, unknown> = {}) => {
  const parsed = parseOptions({ oauth })
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.options
}

describe("the X app client", () => {
  test("is named X app in /connect, with the client ID as the key and the secret as an optional field", async () => {
    let method: unknown
    let name: string | undefined
    await registerAppIntegration({
      transform: async (callback) =>
        (callback({
          update: (id: string, update: (draft: { name: string }) => void) => {
            expect(id).toBe("x-app")
            const draft = { name: "" }
            update(draft)
            name = draft.name
          },
          method: { update: (input: { method: unknown }) => void (method = input.method) },
        } as never), { dispose: async () => {} }),
    })
    expect(APP_NAME).toBe("X app")
    expect(name).toBe("X app")
    expect(method).toEqual({
      type: "key",
      label: "X app client ID",
      form: [{ key: "client_secret", type: "string", title: "Client secret", description: "Only for a confidential (Web App) X app. Skip it for a Native App, which has no secret.", required: false }],
    })
  })

  test("comes from the plugin options first, secret included, and never from a shipped default", async () => {
    const state = await resolveClient({ connection: { active: async () => undefined, resolve: async () => undefined, status: async () => {} } }, options({ client_id: "client-1", client_secret: "secret-1" }))
    expect(state).toEqual({ client: { id: "client-1", secret: "secret-1", source: "options" }, invalid: false })
    const publicApp = await resolveClient({ connection: { active: async () => undefined, resolve: async () => undefined, status: async () => {} } }, options({ client_id: "client-2" }))
    expect(publicApp).toEqual({ client: { id: "client-2", source: "options" }, invalid: false })
  })

  test("comes from the /connect X app entry otherwise, with its stored secret when one was given", async () => {
    const connection = { type: "credential" as const, id: "c1", label: "Example account", method: "key" as const }
    const stored = { type: "key" as const, key: "client-3", metadata: { client_secret: "secret-3" } }
    const reports: unknown[] = []
    const state = await resolveClient(
      { connection: { active: async () => connection, resolve: async () => stored, status: async (input: { status: unknown }) => { reports.push(input.status) } } },
      options(),
    )
    expect(state).toEqual({ client: { id: "client-3", secret: "secret-3", source: "connect" }, invalid: false })
    expect(reports).toEqual([undefined])
  })

  test("marks an unusable stored client in /connect and registers nothing", async () => {
    const connection = { type: "credential" as const, id: "c1", label: "Example account", method: "key" as const }
    const stored = { type: "key" as const, key: "has space", metadata: {} }
    const reports: unknown[] = []
    const state = await resolveClient(
      { connection: { active: async () => connection, resolve: async () => stored, status: async (input: { status: unknown }) => { reports.push(input.status) } } },
      options(),
    )
    expect(state).toEqual({ invalid: true })
    expect(reports).toEqual([{ status: "needs_auth", message: "This is not an X client ID: it is empty or has spaces." }])
  })

  test("is absent when nothing is stored, and compares structurally", async () => {
    const empty = await resolveClient({ connection: { active: async () => undefined, resolve: async () => undefined, status: async () => {} } }, options())
    expect(empty).toEqual({ invalid: false })
    const a: ClientState = { client: { id: "client-1", source: "connect" }, invalid: false }
    expect(sameClient(a, { ...a })).toBe(true)
    expect(sameClient(a, { client: { id: "client-2", source: "connect" }, invalid: false })).toBe(false)
  })
})

describe("the server entry", () => {
  test("pins the client, the callback, the scopes and the secret", () => {
    expect(serverConfig(options({ client_id: "client-1", client_secret: "secret-1" }), { id: "client-1", secret: "secret-1", source: "options" })).toEqual({
      type: "remote",
      url: "https://api.x.com/mcp",
      oauth: { client_id: "client-1", redirect_uri: REDIRECT_URI, scope: SCOPES.join(" "), client_secret: "secret-1" },
    })
  })

  test("leaves the secret out for a public Native App, and sets callback_port only for an https redirect", () => {
    expect(serverConfig(options({ client_id: "client-1" }), { id: "client-1", source: "connect" }).oauth).not.toHaveProperty("client_secret")
    const hosted = options({ client_id: "client-1", redirect_uri: "https://example.com/callback", callback_port: 8767 })
    expect(serverConfig(hosted, { id: "client-1", source: "options" }).oauth).toMatchObject({ redirect_uri: "https://example.com/callback", callback_port: 8767 })
  })

  test("takes the test endpoint, and names the mode without ever showing the secret", () => {
    expect(serverConfig(options({ client_id: "client-1" }), { id: "client-1", source: "options" }, "http://127.0.0.1:1/mcp").url).toBe("http://127.0.0.1:1/mcp")
    expect(clientMode({ id: "client-1", source: "options" })).toBe("public_pkce")
    expect(clientMode({ id: "client-1", secret: "secret-1", source: "options" })).toBe("confidential")
  })
})
