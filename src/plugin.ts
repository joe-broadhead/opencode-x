import { Plugin, type Mcp } from "@opencode/plugin"
import { reasonOf } from "./redact.js"
import { errorText, ENDPOINT, NAMESPACE_DESCRIPTION, PLUGIN_ID, SERVER_NAME, SUPPORTED_HOST } from "./constants.js"
import { checkHost, isSupportedHost } from "./host-version.js"
import { registerToolsRpc, METHODS, shapeInput, shapeResult } from "./host/tools-rpc.js"
import { eventsMethod, eventsTool, type EventsToolOptions } from "./events.js"
import { watchIntegration } from "./integration.js"
import { watchListing } from "./listing.js"
import { parseOptions, type Options } from "./options.js"
import { defaultRules, registerDefaultRules } from "./permissions.js"
import { loadSkills, registerSkills } from "./skills.js"
import { clientNextStep, readStatus, registerStatusCommand, registerStatusRpc, type ServerSource } from "./status.js"
import { registerAppIntegration, resolveClient, sameClient, type ClientState } from "./connect.js"
import { serverConfig } from "./server.js"
import { configureBilling, registerBilling } from "./billing.js"

/** Internal seam: tests point the server at a loopback fake without OAuth, and at their own skills. */
interface XSeam {
  readonly endpoint: string
  readonly oauth?: false
  readonly skillsDir?: string
}

type RemoteConfig = Extract<Mcp.ServerConfig, { type: "remote" }>

/** A remote MCP server config for X's server, at the seam's endpoint. `oauth: false` is the tests' no-auth mode. */
export const serverEntry = (seam: XSeam, options: Options, client: ClientState): RemoteConfig | undefined => {
  if (seam.oauth === false) return { type: "remote", url: seam.endpoint, oauth: false }
  return client.client === undefined ? undefined : serverConfig(options, client.client, seam.endpoint)
}

/** Origin and path only, so a token in a query string never reaches status. */
export function displayUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`
  } catch {
    return "an invalid URL"
  }
}

/**
 * A conflicting server's address for status. Another origin shows only its origin, because its path can hold a secret,
 * as some servers' URLs do. X's own origin keeps its path, so a wrong path there is visible.
 */
function conflictUrl(url: string, expected: string) {
  try {
    const parsed = new URL(url)
    if (parsed.origin === new URL(expected).origin) return displayUrl(url)
    return parsed.pathname.replace(/\/+$/, "") === "" ? parsed.origin : `${parsed.origin}/…`
  } catch {
    return "an invalid URL"
  }
}

/**
 * Registers `x`, or adopts the user's own `mcp.servers.x` unchanged when it points at X's URL:
 * user config is applied first, and a later `set` would replace it. Of the user's entry only its type, its URL and
 * whether `oauth` is false are read, never its headers, which may hold a secret. Any other URL, or a local command,
 * is a conflict, and nothing is added. Without a client and without a user entry, nothing is registered: status asks
 * for the app. `config` is read on every replay, so a client saved in /connect applies at once. Synchronous and never
 * throws.
 */
export function registerServer(
  mcp: Pick<Plugin.Context["mcp"], "transform">,
  config: () => RemoteConfig | undefined,
  record: (source: ServerSource | undefined, problem?: string) => void,
) {
  return mcp.transform((editor) => {
    try {
      const existing = editor.get(SERVER_NAME)
      const entry = config()
      const expected = displayUrl(entry?.url ?? ENDPOINT)
      if (!existing) {
        if (entry) editor.set(SERVER_NAME, entry)
        return record(entry ? { type: "plugin", url: expected, signIn: "oauth" } : undefined)
      }
      if (existing.type !== "remote") return record({ type: "conflict", url: "a local command", expected })
      const url = displayUrl(existing.url)
      const signIn = existing.oauth === false ? "own" : "oauth"
      record(url === expected ? { type: "adopted", url, signIn } : { type: "conflict", url: conflictUrl(existing.url, entry?.url ?? ENDPOINT), expected })
    } catch (error) {
      record(undefined, errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server could not be registered (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
}

export function createXPlugin(seam: XSeam) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      const parsed = parseOptions(ctx.options)
      const supported = isSupportedHost(ctx.app.version)
      // Never throws: the check is built with the override, and the setup facts below decide whether the plugin runs.
      const host = checkHost(ctx.app.version, true)
      const setup = !parsed.ok
        ? { code: "OPTIONS_INVALID" as const, message: `Option ${parsed.error.field}: ${parsed.error.message}`, nextStep: parsed.error.next }
        : !supported && !parsed.options.allowUntestedHost
          ? {
              code: "HOST_UNTESTED" as const,
              message: `OpenCode ${ctx.app.version || "of an unknown version"} is outside the supported range ${SUPPORTED_HOST}, so X is not set up.`,
              nextStep: `Use OpenCode ${SUPPORTED_HOST}, or set "allowUntestedHost": true in this plugin's options to run anyway.`,
            }
          : undefined
      const options = parsed.ok && setup === undefined ? parsed.options : undefined
      const { skills, problems: skillProblems } = options === undefined ? { skills: [], problems: [] } : await loadSkills(seam.skillsDir)
      // Transforms replay on every rebuild, so each one overwrites its own entry rather than appending.
      const problems = new Map<string, string>(skillProblems.map((problem, index) => [`skill:${index}`, problem]))
      const report = (area: string) => (problem: string | undefined) => void (problem ? problems.set(area, problem) : problems.delete(area))
      const listing = watchListing(ctx)
      let source: ServerSource | undefined
      const ownedServer = () => source?.type === "plugin" || source?.type === "adopted"
      const bundled = skills.map((skill) => ({ id: skill.id, path: skill.path }))
      let client: ClientState = { invalid: false }
      let stopWatch = async () => {}
      let stopTools = async () => {}
      let stopBilling = async () => {}
      const stopped = new AbortController()
      let listening: Promise<void> = Promise.resolve()
      let queue = Promise.resolve()

      if (options !== undefined) {
        const fromConnect = options.clientId === undefined
        if (fromConnect) await registerAppIntegration(ctx.integration)
        client = await resolveClient(ctx.integration, options).catch(() => client)
        await registerServer(ctx.mcp, () => serverEntry(seam, options, client), (next, problem) => {
          source = next
          report("server")(problem)
        })
        // Memory's source of X events, a Code Mode tool in the x namespace and the tools RPC method events_list. It
        // never calls a server at another URL, and reads status (registered below) only when it cannot call X.
        const events: EventsToolOptions = {
          tool: ctx.tool,
          permission: ctx.permission,
          feeds: options.feeds,
          maxCalls: options.maxCalls,
          owned: () => source?.type !== "conflict",
          status: () => read(),
        }
        // Code Mode's catalog describes the server's namespace with this text; a server at another URL keeps its own.
        await ctx.tool.transform((editor) => {
          if (source && source.type !== "conflict") editor.namespace({ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION })
          editor.add(eventsTool(events))
        })
        // The cost line, on the model path and in Code Mode; reads pass to X unchanged. A conflicting server is not ours.
        stopBilling = await registerBilling(ctx.tool, () => source === undefined || source.type !== "conflict", options.ownsXApp)
        await registerDefaultRules(ctx.agent, defaultRules(options.access), report("rules"))
        await registerSkills(ctx.skill, skills)
        // A client saved, switched or removed in /connect applies without a restart: the server transform reads the
        // current client on every replay.
        const updateClient = async () => {
          const next = await resolveClient(ctx.integration, options)
          if (sameClient(next, client)) return
          client = next
          await ctx.mcp.reload()
        }
        const handle = (work: () => Promise<unknown>) => {
          queue = queue.then(() => (stopped.signal.aborted ? undefined : work())).then(() => undefined, () => undefined)
        }
        // A client and credential that already exist at boot are read once here: the host can load the /connect
        // store after this setup runs, so retry briefly instead of waiting for an unrelated config reload.
        if (fromConnect) {
          void (async () => {
            for (let attempt = 0; attempt < 10 && !stopped.signal.aborted; attempt++) {
              const next = await resolveClient(ctx.integration, options).catch(() => client)
              if (next.client !== undefined) {
                if (!sameClient(next, client)) {
                  client = next
                  await ctx.mcp.reload()
                }
                return
              }
              await delay(200, stopped.signal)
            }
          })()
        }
        // One handler at a time, in event order.
        listening = (async () => {
          if (!fromConnect) return
          while (!stopped.signal.aborted) {
            try {
              const events = ctx.event.subscribe({ types: ["integration.updated", "credential.updated", "credential.switched"], signal: stopped.signal })
              for await (const _event of events) handle(updateClient)
            } catch {
              // The stream failed; subscribe again.
            }
            await delay(1_000, stopped.signal)
          }
        })()
        // Scripts call X's tools with no model, as a session and its agent: the known tools, under the session's rules.
        // A user's own server under the name is not this plugin's. Without a client and without a user entry there is
        // no server: a call gets the status's code and next step, read at each call, so a client saved in /connect
        // applies at once. Script budgets are opt-in: without them, X's own billing and limits apply.
        await configureBilling({ storage: ctx.storage, sessionBudgetUsd: options.scriptBudgetUsd, dailyBudgetUsd: options.scriptDailyBudgetUsd, ownsXApp: options.ownsXApp })
        stopTools = await registerToolsRpc(ctx, {
          methods: [...METHODS, eventsMethod(events)],
          shapers: { input: (method, input, call) => shapeInput(method, input, call, options.ownsXApp), result: (method, result, call) => shapeResult(method, result, call, options.ownsXApp) },
          mcp: {
            server: SERVER_NAME,
            managed: () => source?.type !== "conflict",
            notRegistered: () =>
              source !== undefined || client.client !== undefined
                ? undefined
                : { code: client.invalid ? "CLIENT_ID_INVALID" : "CLIENT_ID_MISSING", next: clientNextStep() },
          },
        })
        stopWatch = watchIntegration(ctx, ownedServer)
      }

      const read = () =>
        readStatus(ctx, {
          ...(source ? { source } : {}),
          client,
          ...(options ? { options } : {}),
          ...(setup ? { setup } : {}),
          host,
          problems: [...problems.values()],
          skills: bundled,
          listing,
        })
      await registerStatusCommand(ctx, read)
      await registerStatusRpc(ctx.rpc, read)
      return async () => {
        stopped.abort()
        await listening
        await queue
        await stopWatch()
        await stopTools()
        await stopBilling()
        await listing.stop()
      }
    },
  })
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
