import type { Plugin, Rpc } from "@opencode/plugin"
import { DISPLAY_NAME, ENDPOINT, PLUGIN_ID, SCOPES, SERVER_NAME, TESTED_HOSTS } from "./constants.js"
import { isSupportedHost, type HostCheck } from "./host-version.js"
import { ASK_READ_TOOLS, classify, DENY_TOOLS, PUBLIC_TOOLS, WRITE_TOOLS } from "./x-tools.js"
import { defaultRules, unguardedAgents, type Rule } from "./permissions.js"
import { cut, oneLine, shortReason } from "./redact.js"
import { clientMode } from "./server.js"
import { APP_NAME, type ClientState } from "./connect.js"
import type { Options } from "./options.js"
import { VERSION } from "./version.js"

export { shortReason }

/** The shared status labels in machine form; `/x-status` shows them as `sign-in required` and so on. */
type State = "connected" | "sign_in_required" | "connecting" | "disabled" | "failed" | "not_configured" | "conflict" | "host_untested"

/** The setup codes status itself can be in, beside the problems a transform or the skills report. */
export type StatusCode = "OPTIONS_INVALID" | "HOST_UNTESTED" | "CLIENT_ID_MISSING" | "CLIENT_ID_INVALID"

/**
 * Who owns the `x` server: this plugin, the user's own config (adopted unchanged), or a server at another URL
 * (`expected` is X's). URLs are shown as origin and path only. `signIn` is `own` for an adopted entry with
 * `oauth: false`, which has no `/connect` entry: X's server signs in only with OAuth, so such an entry fails.
 */
export type ServerSource =
  | { readonly type: "plugin"; readonly url: string; readonly signIn: "oauth" }
  | { readonly type: "adopted"; readonly url: string; readonly signIn: "oauth" | "own" }
  | { readonly type: "conflict"; readonly url: string; readonly expected: string }

interface SkillPath {
  readonly id: string
  readonly path: string
}

/** What status is built from. The TUI fills what it can see; fields it cannot see stay undefined. */
export interface StatusFacts {
  readonly server?: { readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; readonly error?: string }
  readonly source?: ServerSource
  /** The label OpenCode keeps on the active sign-in, if it has one. */
  readonly account?: string
  /** The client the plugin would sign in with, from the options or the /connect X app entry. */
  readonly client?: ClientState
  /** The options in force, for the Callback and Scopes rows; absent when setup stopped before them. */
  readonly options?: Options
  /** Where setup stopped before any server could be registered: invalid options, or a host outside the range. */
  readonly setup?: { readonly code: "OPTIONS_INVALID" | "HOST_UNTESTED"; readonly message: string; readonly nextStep: string }
  readonly host: HostCheck
  /** The names of the tools the `x` server serves, without the `x_` prefix. */
  readonly tools?: readonly string[]
  /**
   * The server's status changed moments ago: a server that just connected lists its tools shortly after, so no tools
   * yet means "still listing", not "none for this app".
   */
  readonly settling?: boolean
  readonly agents?: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]
  readonly problems?: readonly string[]
  /** The plugin's own skills, and the skills OpenCode lists; the listed one wins when both have an id. */
  readonly skills?: { readonly own: readonly SkillPath[]; readonly listed: readonly SkillPath[] }
}

/**
 * One status model for `/x-status`, the `/x` dialog and the status RPC. `version`, `host`, `state`,
 * `unguardedAgents` and `nextStep` are the fields every plugin of this family shares; the rest are X's own.
 */
export interface Status {
  /** The plugin's version. */
  readonly version: string
  readonly state: State
  /** For a setup state, or a missing or unusable X app client, the code that explains it. */
  readonly code?: StatusCode
  /** One sentence on the code: what happened. */
  readonly message?: string
  /** For a failed connection only: OpenCode's reason, on one line of at most 160 characters, URLs without their query. */
  readonly error?: string
  readonly source?: ServerSource
  /**
   * The label OpenCode keeps on the active sign-in, on one line of at most 80 characters; absent when it has none.
   * Status makes no X call, because every call costs money, so the plugin learns nothing else about the account.
   */
  readonly account?: string
  /** The X app OpenCode signs in with: its client ID, whether it has a secret, and where it came from. Never the secret. */
  readonly client?: { readonly id: string; readonly mode: "public_pkce" | "confidential"; readonly source: "options" | "connect" }
  /** The redirect URI the app must have registered, exactly as X matches it. */
  readonly callback?: string
  /** OpenCode's local listener port for an `https:` callback. */
  readonly callbackPort?: number
  /** The scopes OpenCode requests, `offline.access` included. */
  readonly scopes?: readonly string[]
  /** How many X tools OpenCode lists and the default rules let run or ask: the listed ones that are not denied. */
  readonly tools: number
  /** The listed tools that the default rules deny; a later rule of the user's can turn one on. Empty today. */
  readonly deniedTools: readonly string[]
  /** True while a server that just connected may still be listing its tools. */
  readonly listing: boolean
  /** How many of them the plugin does not know. */
  readonly unknownCount: number
  /** Up to 20 of the unknown tools' names, only those made of lowercase letters, digits and `_`. */
  readonly unknownTools: readonly string[]
  /** Agents where a new X tool would run without asking; empty when there are none. */
  readonly unguardedAgents: readonly string[]
  /** The plugin's skills that OpenCode loads from another file of the same id instead. */
  readonly shadowedSkills?: readonly SkillPath[]
  readonly host: HostCheck
  readonly problems: readonly string[]
  /** The one next step: the `Next step` row, "Nothing to do." when nothing is needed. */
  readonly nextStep: string
}

const SIGN_IN = "Run `/connect` and choose X, then press `o` or Enter to open the link (in a terminal, `opencode mcp auth x` opens it automatically)."

/** The default rules to paste into an agent's own permissions, one rule a line, as a JSON array body. */
const AGENT_RULES = defaultRules()
  .map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`)
  .join("\n")

/** The next step while agents lack the rules: the family's one fixed sentence. */
const AGENTS_NEXT_STEP =
  "Put the default rules shown by /x-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for X tools."

const NOTHING_TO_DO = "Nothing to do."

const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`
const LISTED_UNKNOWN = 20
// A tool name comes from the server; list only plain names.
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/

/** The plugin's skills that OpenCode lists from another file: a skill with the same id, such as a user's, replaced it. */
function shadowedOf(facts: StatusFacts): SkillPath[] {
  return (facts.skills?.own ?? []).flatMap((own) => {
    const listed = facts.skills?.listed.find((skill) => skill.id === own.id)
    return listed && listed.path !== own.path ? [{ id: own.id, path: listed.path }] : []
  })
}

/** The longest account label status shows. */
const ACCOUNT_LIMIT = 80

const STATE_OF = { connected: "connected", pending: "connecting", needs_auth: "sign_in_required", failed: "failed", disabled: "disabled" } as const

/** The next step while no usable X app client ID is set: status's, and the tools RPC's for CLIENT_ID_MISSING. */
export function clientNextStep(): string {
  return `Run /connect and choose ${APP_NAME}, and paste your X app's client ID.`
}

/** Why the app lists no tools: the two X setup traps a signed-in token can still hit. */
const NO_TOOLS = `X lists no tools for this app. Check that the app is in Pay-per-use, Production at console.x.com, that it has the OAuth 2.0 scopes ${SCOPES.join(" ")}, then sign in again.`

export function buildStatus(facts: StatusFacts): Status {
  const client = facts.client?.client
  const state: State = facts.setup
    ? facts.setup.code === "HOST_UNTESTED" ? "host_untested" : "not_configured"
    : facts.source?.type === "conflict" ? "conflict"
      : facts.server ? STATE_OF[facts.server.status]
        : "not_configured"
  const missing = facts.source === undefined && facts.server === undefined && client === undefined && facts.setup === undefined
  const listed = facts.tools ?? []
  const unknown = listed.filter((tool) => classify(tool) === "unknown")
  const denied = listed.filter((tool) => classify(tool) === "denied")
  // OpenCode's text for a needed sign-in can hold an authorization URL, so only a failure's reason is kept.
  const error = facts.server?.status === "failed" && facts.server.error ? shortReason(facts.server.error) : undefined
  const shadowed = shadowedOf(facts)
  const account = facts.account ? cut(oneLine(facts.account), ACCOUNT_LIMIT) : ""
  const setup = facts.setup
  // An adopted entry is the user's own, used unchanged: its client and callback are not the plugin's to claim.
  const own = facts.source?.type !== "adopted"
  const status = {
    version: VERSION,
    state,
    ...(setup ? { code: setup.code, message: setup.message } : missing ? missingClient(facts.client) : {}),
    ...(error ? { error } : {}),
    ...(facts.source ? { source: facts.source } : {}),
    ...(account ? { account } : {}),
    ...(client && own ? { client: { id: client.id, mode: clientMode(client), source: client.source } } : {}),
    ...(facts.options && own ? { callback: facts.options.redirectUri, ...(facts.options.callbackPort === undefined ? {} : { callbackPort: facts.options.callbackPort }), scopes: facts.options.scopes } : {}),
    tools: listed.length - denied.length,
    deniedTools: denied,
    listing: state === "connected" && listed.length === 0 && facts.settling === true,
    unknownCount: unknown.length,
    unknownTools: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN),
    unguardedAgents: unguardedAgents(facts.agents ?? []),
    ...(shadowed.length ? { shadowedSkills: shadowed } : {}),
    host: facts.host,
    problems: facts.problems ?? [],
  }
  return { ...status, nextStep: nextStepOf(status, setup?.nextStep) }
}

/** A missing or unusable X app client: its code and one sentence. */
function missingClient(client: ClientState | undefined): { readonly code: StatusCode; readonly message: string } {
  return client?.invalid
    ? { code: "CLIENT_ID_INVALID", message: "The client ID saved in the /connect X app entry is empty or has spaces, so x is not added." }
    : { code: "CLIENT_ID_MISSING", message: "No X app client ID is set, so x is not added." }
}

function nextStepOf(status: Omit<Status, "nextStep">, setupNext: string | undefined): string {
  const { source } = status
  switch (status.state) {
    case "host_untested":
      return setupNext ?? "Use OpenCode >=2.2.3 <2.3.0, or set \"allowUntestedHost\": true in this plugin's options to run anyway."
    case "conflict": {
      const { url, expected } = source as Extract<ServerSource, { type: "conflict" }>
      return `Your OpenCode config defines mcp.servers.${SERVER_NAME} with ${url}, but the plugin uses ${expected}. Point it at ${expected} or remove it, then restart OpenCode.`
    }
    case "not_configured":
      if (status.code === "OPTIONS_INVALID") return setupNext ?? "Fix the plugin options in opencode.json, then restart OpenCode."
      if (status.code === "CLIENT_ID_INVALID" || status.code === "CLIENT_ID_MISSING") return clientNextStep()
      return `OpenCode has no ${SERVER_NAME} MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode.`
    case "disabled":
      return `The ${SERVER_NAME} MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
    case "connecting":
      return "X is still connecting. Run /x-status again in a few seconds."
    case "sign_in_required":
      return SIGN_IN
    case "failed":
      // X's server signs in only with OAuth, so an entry of the user's own with `oauth: false` cannot connect.
      if (source?.type === "adopted" && source.signIn === "own") {
        return `X's server signs in only with OAuth: remove "oauth": false from your own mcp.servers.${SERVER_NAME} in opencode.json, then restart OpenCode and sign in.`
      }
      return "Check your network, then run /x-status again."
  }
  if (status.listing) return "X is still listing its tools. Run /x-status again in a few seconds."
  if (status.tools === 0 && status.deniedTools.length === 0) return NO_TOOLS
  if (status.unguardedAgents.length) return AGENTS_NEXT_STEP
  // A problem reads `CODE: What happened. Next step: What to do.`; its own next step becomes the status's.
  const problem = status.problems[0]?.split(" Next step: ")[1]
  if (problem) return problem
  if (status.shadowedSkills?.length) {
    return `Rename or move ${status.shadowedSkills.map((skill) => `the "${skill.id}" skill at ${skill.path}`).join(" and ")}, which OpenCode loads instead of the plugin's skill of the same name.`
  }
  // An untested host changes no next step: the OpenCode row says it is untested.
  return NOTHING_TO_DO
}

const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
  host_untested: "host untested",
}

/** The permission posture, which the default rules fix. */
const RULES_NOT_ADDED = "RULES_NOT_ADDED:"

/** The server's address and owner, after the state label. */
function serverText(source: ServerSource) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}${source.signIn === "own" ? " without OAuth" : ""}, used unchanged`
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`
}

function toolsText({ tools, unknownCount, unknownTools, deniedTools, listing }: Status) {
  if (listing) return "none listed yet (X is still listing them)"
  const off = deniedTools.length ? `; off by default: ${list(deniedTools)}` : ""
  if (unknownCount === 0) return `${tools} available, 0 unknown${off}`
  const more = unknownCount - unknownTools.length
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  return `${tools} available, ${unknownCount} unknown${names} (unknown tools ask before running)${off}`
}

const list = (names: readonly string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)

/**
 * The permission posture the default rules fix, derived from the tool lists so it cannot go stale, and whether those
 * rules are in place: facts status can check, not a fixed claim. The last clause is X's cost, in one clause (D10).
 */
const ASK_COUNT = WRITE_TOOLS.length + ASK_READ_TOOLS.length + PUBLIC_TOOLS.length
const POSTURE = `reads run without asking; ${ASK_COUNT} tools ask first (bookmarks, lists, an Article draft, source keys and a public Post); ${DENY_TOOLS.length} are off (DMs and chat, calls, follows, blocks, mutes, list membership, moderators and live video); X bills every tool call to the X developer account that owns the app`

function accessText({ problems, unguardedAgents }: Status) {
  const rules = problems.some((problem) => problem.startsWith(RULES_NOT_ADDED))
    ? "default rules not added (see the OpenCode row)"
    : unguardedAgents.length
      ? "default rules missing in the agents listed below"
      : "no agent runs new X tools unasked"
  return `${POSTURE}; ${rules}`
}

/** The OpenCode row: the version, whether it is tested, the supported range, then any setup problems. */
function hostText({ host, problems }: Status) {
  const { version, range, tested } = host
  const outside = version === null || !isSupportedHost(version)
  const notes = [
    ...(outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If X misbehaves, use OpenCode ${TESTED_TEXT}.`] : []),
    ...problems,
  ]
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`
}

const CLIENT_SOURCE = { options: "set in plugin options", connect: "saved in /connect" } as const
const CLIENT_APP = { options: "configured app", connect: "your own app" } as const

/** The rows shared by `/x-status` and the dialog, in the standard order with X's own rows after Access. */
function rows(status: Status): { readonly label: string; readonly value: string }[] {
  const { source, unguardedAgents: agents, client } = status
  const details = [status.error, source && serverText(source), status.listing && "still listing its tools"].filter(Boolean).join("; ")
  const head = `${STATE_TEXT[status.state]}${status.code === undefined ? "" : `. ${status.code}: ${status.message ?? ""}`}${details ? ` (${details})` : ""}`
  const out = [
    { label: "Connection", value: head },
    { label: "Account", value: status.account ?? `account name not reported by ${DISPLAY_NAME}'s MCP` },
    { label: "Access", value: accessText(status) },
    { label: "Server", value: `${SERVER_NAME} at ${ENDPOINT}` },
  ]
  if (client !== undefined) {
    // Status cannot tell managed config from a user's own options, so it names the source and the mode, not a team.
    const app = `${CLIENT_APP[client.source]}, ${client.mode === "public_pkce" ? "public" : "confidential"}`
    out.push({ label: "Client", value: `${client.id} (${app}; ${CLIENT_SOURCE[client.source]})` })
  }
  if (status.callback !== undefined) out.push({ label: "Callback", value: callbackRow(status.callback, status.callbackPort) })
  if (status.scopes !== undefined) out.push({ label: "Scopes", value: status.scopes.join(" ") })
  out.push(
    { label: "Tools", value: toolsText(status) },
    { label: "Agents without default rules", value: agents.length ? `${agents.join(", ")}\n${AGENT_RULES}` : "none" },
    { label: "OpenCode", value: hostText(status) },
    { label: "Next step", value: status.nextStep },
  )
  return out
}

/** The callback to register, and for an `https:` one where its proxy forwards it: OpenCode's listener, same path. */
function callbackRow(callback: string, port: number | undefined): string {
  const register = "register exactly this URL in the app's User authentication settings"
  if (port === undefined) return `${callback} (${register})`
  return `${callback} (${register}, and forward it to http://127.0.0.1:${port}${new URL(callback).pathname}, where OpenCode listens)`
}

export function formatStatus(status: Status) {
  return ["X status", ...rows(status).map((row) => `- ${row.label}: ${row.value}`)].join("\n")
}

export interface StatusContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly agent: Pick<Plugin.Context["agent"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
  readonly skill: Pick<Plugin.Context["skill"], "list">
  readonly integration: { readonly connection: Pick<Plugin.Context["integration"]["connection"], "active"> }
}

/** When the server's status last changed, or the watcher started, in milliseconds since the epoch. */
interface ListingState {
  readonly changedAt: () => number
}

/** How long after a status change no tools still means "listing". */
const LISTING_MS = 15_000

/** Reads the live facts through public host APIs; never calls X, because every call costs money. */
export async function readStatus(
  ctx: StatusContext,
  facts: Pick<StatusFacts, "source" | "client" | "options" | "setup" | "host" | "problems"> & { readonly skills?: readonly SkillPath[]; readonly listing?: ListingState },
) {
  const [servers, agents, tools, listed] = await Promise.all([
    ctx.mcp.list(),
    ctx.agent.list(),
    ctx.tool.list(),
    // The skill check is advice; a failed list must not hide the rest of the status.
    ctx.skill.list().then(
      (result) => result.data,
      () => undefined,
    ),
  ])
  const server = servers.data.find((entry) => entry.name === SERVER_NAME)
  const connection = server?.integrationID ? await ctx.integration.connection.active(server.integrationID).catch(() => undefined) : undefined
  const { skills: own, listing, ...rest } = facts
  const settling = listing !== undefined && Date.now() - listing.changedAt() < LISTING_MS
  return buildStatus({
    ...rest,
    ...(server ? { server: server.status } : {}),
    ...(connection?.type === "credential" && connection.label ? { account: connection.label } : {}),
    tools: tools.filter((tool) => tool.options?.namespace === SERVER_NAME).map((tool) => tool.name),
    settling,
    agents: agents.data,
    ...(own && listed ? { skills: { own, listed } } : {}),
  })
}

/** Why status could not be read: a coded message and its next step. The reason is cut like a failure's. */
function unavailable(error: unknown) {
  const reason = shortReason(error instanceof Error ? error.message : String(error))
  return {
    message: `STATUS_UNAVAILABLE: Could not read X's status${reason ? ` (${reason})` : ""}.`,
    nextStep: "Restart OpenCode, then run /x-status again.",
  }
}

const strings = { type: "array", items: { type: "string" } }
const count = { type: "integer", minimum: 0 }
const nullableString = { type: ["string", "null"] }

/**
 * One read-only method for the TUI view and scripts. The TUI part does not receive the plugin options on 2.2.x, and
 * cannot see the server's own findings, so it asks the server for the same status /x-status reports.
 */
export const StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "state", "tools", "deniedTools", "listing", "unknownCount", "unknownTools", "unguardedAgents", "host", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          state: { enum: ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict", "host_untested"] },
          code: { enum: ["OPTIONS_INVALID", "HOST_UNTESTED", "CLIENT_ID_MISSING", "CLIENT_ID_INVALID"] },
          message: { type: "string" },
          error: { type: "string" },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" }, signIn: { enum: ["oauth", "own"] } },
          },
          account: { type: "string" },
          client: {
            type: "object",
            required: ["id", "mode", "source"],
            properties: { id: { type: "string" }, mode: { enum: ["public_pkce", "confidential"] }, source: { enum: ["options", "connect"] } },
          },
          callback: { type: "string" },
          callbackPort: { type: "integer", minimum: 1, maximum: 65535 },
          scopes: strings,
          tools: count,
          deniedTools: strings,
          listing: { type: "boolean" },
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          shadowedSkills: {
            type: "array",
            items: { type: "object", required: ["id", "path"], properties: { id: { type: "string" }, path: { type: "string" } } },
          },
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } },
          },
          problems: strings,
          nextStep: { type: "string" },
        },
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export function registerStatusRpc(rpc: Pick<Plugin.Context["rpc"], "register">, read: () => Promise<Status>) {
  return rpc.register(StatusRpc, {
    status: (_input, { error }) =>
      read().catch((cause: unknown) => {
        const { message, nextStep } = unavailable(cause)
        return error("unavailable", message, { nextStep })
      }),
  })
}

export function registerStatusCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic"> },
  read: () => Promise<Status>,
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "x-status",
      description: "Show X's connection, sign-in, account, tools and the next step",
      execute: async ({ sessionID }) => {
        const text = await read().then(formatStatus, (cause: unknown) => {
          const { message, nextStep } = unavailable(cause)
          return `${message} Next step: ${nextStep}`
        })
        await ctx.session.synthetic({ sessionID, text, description: "X status", resume: false })
      },
    }),
  )
}

