// A loopback Streamable-HTTP MCP server. By default it lists two known reads, every known write, the public Article
// publish and one tool the plugin has never seen. With `catalog: "x"` it lists every tool in src/x-tools.ts and the
// new tool. It answers JSON-RPC POSTs with plain JSON (no SSE stream) and records every tool call, its path and every
// request header. A `tools/call` answers with the tool's name, the path and its arguments as structured content; for a
// `query` that starts with "text", with text alone; or, for a `query` that starts with "fail", with an upstream error
// (`isError`) whose first line holds a signed URL.
//
// While `challenge` is set, every MCP request gets 401 with the bare bearer challenge X's server sends, and the same
// server plays X's sign-in server: protected-resource metadata, and an authorization server at the origin with X's
// endpoints, no dynamic client registration and no client metadata documents, `client_secret_basic` or `none` at the
// token endpoint. It records each token request and its Authorization header, so a test can prove the plugin's static
// client was used. It is also an LM Studio-compatible model API for a scripted model (`model.script`), so a host test
// can run a real session turn that calls X's tools.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { SCOPES } from "../../src/constants.js"
import { DENY_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"

const schema = { type: "object", properties: { query: { type: "string" } } }
/** A tool the plugin has never seen. */
export const NEW_TOOL = { name: "shiny_new_tool", description: "A tool added upstream after the tool lists were written", annotations: {} }
const tool = (name: string, readOnlyHint: boolean) => ({ name, description: `X ${name}`, annotations: { readOnlyHint }, inputSchema: schema })
/** The off tools the host tests exercise, chosen to cover chat, blocking and list membership. */
export const DENIED_SAMPLE = ["add_lists_member", "send_chat_message", "users_id_block"]
const TOOLS = [
  tool("search_posts_all", true),
  tool("get_users_me", true),
  ...WRITE_TOOLS.map((name) => tool(name, false)),
  ...PUBLIC_TOOLS.map((name) => tool(name, false)),
  ...DENIED_SAMPLE.map((name) => tool(name, false)),
  { ...NEW_TOOL, inputSchema: schema },
]
const CATALOG = [
  ...READ_TOOLS.map((name) => tool(name, true)),
  ...[...WRITE_TOOLS, ...PUBLIC_TOOLS].map((name) => tool(name, false)),
  ...DENY_TOOLS.map((name) => tool(name, false)),
  { ...NEW_TOOL, inputSchema: schema },
]

/** The upstream error a "fail" query gets: two lines, the first with a signed URL. */
export const UPSTREAM_FAILURE = "X refused https://files.x.example/a.png?signature=fake-signature-123 for this input\nTraceback: second line"

/** The scopes the plugin pins, and X's protected-resource metadata lists. */
export const X_SCOPES = SCOPES.join(" ")

export interface FakeMcpOptions {
  /** `x` lists every tool the plugin knows, and the new tool. */
  readonly catalog?: "x"
  /**
   * Whether the token endpoint issues a refresh token. Without one, a 401 later needs a new sign-in and leaves the
   * credential in place, as X does when the authorization request lacks `offline.access`.
   */
  readonly refreshTokens?: boolean
  /** Answer the first access token with 401, so the client refreshes it, as an expired token would. */
  readonly expireFirstAccessToken?: boolean
}

/** The scripted model's id, as the fake's model API lists it. */
export const MODEL_ID = "fake-model"

/** A tool call the scripted model makes: the n-th call follows n tool results. */
interface ScriptedCall {
  readonly tool: string
  readonly arguments: Record<string, unknown>
}

export interface FakeMcp {
  readonly url: string
  /**
   * While true, every MCP request gets 401 with a bearer challenge, as X's server answers before a sign-in or after
   * its tokens are revoked. The sign-in server and the model API keep answering.
   */
  challenge: boolean
  /** The server's origin; `${origin}/v1` is the model API and `${origin}/i/oauth2` X's authorization endpoint. */
  readonly origin: string
  readonly model: {
    /** The calls the model makes, one per turn, before it answers with text. */
    script: ScriptedCall[]
    /** Every chat request body, in order. */
    readonly requests: unknown[]
  }
  /** Every dynamic client registration's body, in order: X advertises none, so this stays empty. */
  readonly registrations: Record<string, unknown>[]
  /** Every token request's form, in order. */
  readonly tokens: Record<string, string>[]
  /** The Authorization header of every token request, in order. */
  readonly tokenAuthorizations: (string | undefined)[]
  /** The `client_id` query parameter of every authorization request, in order. */
  readonly authorizationClients: (string | null)[]
  /** The `redirect_uri` query parameter of every authorization request, in order. */
  readonly authorizationRedirects: (string | null)[]
  /** The `scope` query parameter of every authorization request, in order. */
  readonly authorizationScopes: (string | null)[]
  /** Tool names called, in order. */
  readonly calls: string[]
  /** Each tool call with the path it was sent to, in order. */
  readonly called: { readonly tool: string; readonly path: string }[]
  /** The arguments of each tool call, in order, aligned with `calls`. */
  readonly callArguments: Record<string, unknown>[]
  /** The `x-x-test` header of every MCP request, to tell whose server config the host used. */
  readonly markers: (string | undefined)[]
  /** The `authorization` header of every MCP request. */
  readonly authorizations: (string | undefined)[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: { query?: unknown } } }

export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const calls: string[] = []
  const called: { tool: string; path: string }[] = []
  const callArguments: Record<string, unknown>[] = []
  const markers: (string | undefined)[] = []
  const authorizations: (string | undefined)[] = []
  const registrations: Record<string, unknown>[] = []
  const tokens: Record<string, string>[] = []
  const tokenAuthorizations: (string | undefined)[] = []
  const authorizationClients: (string | null)[] = []
  const authorizationRedirects: (string | null)[] = []
  const authorizationScopes: (string | null)[] = []
  let codes = 0
  const answer = (message: Message, path: string) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-x", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: options.catalog === "x" ? CATALOG : TOOLS })
      case "tools/call": {
        const name = message.params?.name ?? ""
        calls.push(name)
        called.push({ tool: name, path })
        const args = message.params?.arguments ?? {}
        callArguments.push(args)
        if (name === "search_posts_all" && String(args.query ?? "") === "cost") {
          const data = Array.from({ length: 10 }, (_, index) => ({ id: String(index), author_id: String(index), created_at: "2026-11-06T00:00:00Z" }))
          const users = Array.from({ length: 10 }, (_, index) => ({ id: String(index), username: `user${index}` }))
          return reply({ content: [{ type: "text", text: JSON.stringify({ data, includes: { users }, meta: { result_count: 10 } }) }], structuredContent: { data, includes: { users }, meta: { result_count: 10 } } })
        }
        if (String(args.query ?? "").startsWith("fail")) return reply({ content: [{ type: "text", text: UPSTREAM_FAILURE }], isError: true })
        if (String(args.query ?? "").startsWith("text")) return reply({ content: [{ type: "text", text: `text from ${name}` }] })
        return reply({ content: [{ type: "text", text: `called ${name}` }], structuredContent: { tool: name, path, arguments: args } })
      }
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }
  const model = { script: [] as ScriptedCall[], requests: [] as unknown[] }
  // Filled once the server listens; the request handler reads `challenge`, `url` and `origin` from it.
  const fake = { challenge: false } as FakeMcp
  /**
   * One streamed chat completion. A request that offers tools is an agent turn: after n tool results the model makes
   * the n-th scripted call, then answers "Done.". Any other request, such as a title, gets text.
   */
  const chat = (response: ServerResponse, body: string) => {
    const request = JSON.parse(body) as { tools?: unknown[]; messages?: { role: string }[] }
    model.requests.push(request)
    const results = (request.messages ?? []).filter((message) => message.role === "tool").length
    const call = request.tools?.length ? model.script[results] : undefined
    const chunk = (delta: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const usage = `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${results + 1}`, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.arguments) } }] }
      : { role: "assistant", content: "Done." }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(`${chunk(delta, null)}${chunk({}, call ? "tool_calls" : "stop")}${usage}data: [DONE]\n\n`)
  }
  /** X's sign-in server, in its shape: the resource's metadata, and an authorization server with no registration. */
  const signIn = async (request: IncomingMessage, response: ServerResponse, route: string) => {
    const json = (status: number, body: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
    const issuer = fake.origin
    if (route.startsWith("/.well-known/oauth-protected-resource")) {
      return json(200, { resource: fake.url, authorization_servers: [issuer], scopes_supported: X_SCOPES.split(" "), bearer_methods_supported: ["header"] })
    }
    if (["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"].includes(route)) {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/i/oauth2/authorize`,
        token_endpoint: `${issuer}/2/oauth2/token`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
        scopes_supported: X_SCOPES.split(" "),
      })
    }
    // Like a signed-in browser: the authorization endpoint sends the loopback callback a code, and the token endpoint
    // exchanges it for an access token and a refresh token.
    if (route === "/i/oauth2/authorize") {
      const query = new URL(request.url ?? "/", "http://127.0.0.1").searchParams
      authorizationClients.push(query.get("client_id"))
      authorizationRedirects.push(query.get("redirect_uri"))
      authorizationScopes.push(query.get("scope"))
      const target = new URL(query.get("redirect_uri") ?? "/")
      target.searchParams.set("code", `fake-code-${++codes}`)
      if (query.get("state")) target.searchParams.set("state", query.get("state")!)
      return void response.writeHead(302, { location: target.toString() }).end()
    }
    if (route === "/2/oauth2/token" && request.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await read(request)))
      tokens.push(form)
      tokenAuthorizations.push(header(request, "authorization"))
      // While the server challenges, a refresh is refused like a revoked token: the person must sign in again.
      if (fake.challenge && form.grant_type === "refresh_token") return json(400, { error: "invalid_grant" })
      return json(200, {
        access_token: `fake-access-${tokens.length}`,
        token_type: "Bearer",
        expires_in: 3600,
        ...(options.refreshTokens === false ? {} : { refresh_token: `fake-refresh-${tokens.length}` }),
        scope: X_SCOPES,
      })
    }
    return json(404, { error: "not_found" })
  }
  const server = createServer(async (request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    if (route === "/api/v1/models") {
      const models = [{ type: "llm", key: MODEL_ID, display_name: "Fake model", loaded_instances: [], max_context_length: 32_000, capabilities: { vision: false, trained_for_tool_use: true } }]
      return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ models }))
    }
    if (route === "/v1/chat/completions") return chat(response, await read(request))
    if (route.startsWith("/.well-known/") || route.startsWith("/i/oauth2") || route.startsWith("/2/oauth2")) return signIn(request, response, route)
    markers.push(header(request, "x-x-test"))
    authorizations.push(header(request, "authorization"))
    if (fake.challenge || (options.expireFirstAccessToken && header(request, "authorization") === "Bearer fake-access-1")) {
      const metadata = `${fake.origin}/.well-known/oauth-protected-resource`
      return void response
        .writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${metadata}"` })
        .end(JSON.stringify({ error: "invalid_token" }))
    }
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const body = JSON.parse(await read(request)) as Message | Message[]
    const replies = (Array.isArray(body) ? body : [body]).filter((message) => message.id !== undefined).map((message) => answer(message, route))
    if (!replies.length) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  Object.assign(fake, {
    url: `http://127.0.0.1:${port}/mcp`,
    origin: `http://127.0.0.1:${port}`,
    model,
    registrations,
    tokens,
    tokenAuthorizations,
    authorizationClients,
    authorizationRedirects,
    authorizationScopes,
    calls,
    called,
    callArguments,
    markers,
    authorizations,
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  })
  return fake
}

const header = (request: IncomingMessage, name: string) => [request.headers[name]].flat()[0]

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
