// Accounts: one vendor MCP server per alias, and the profile that tells OpenCode which X app to sign in with.
//
// X's hosted MCP server holds the account's OAuth credential, so the contract's `mcp` mechanism applies: `x` for the
// `default` alias and `x-<alias>` for any other. X has no dynamic client registration, so every server entry carries
// the person's own X developer app as `oauth.client_id`; a native app uses PKCE and needs no secret, and a confidential
// app names the environment variable that holds its secret, never the secret itself.
import { accountName, type AccountProfile, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest, Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { ServerState } from "./provider/errors.js"
import { PLUGIN, X_ENDPOINT, X_REDIRECT_URI, X_SCOPES } from "./provider/index.js"

/** One X MCP server, as the host takes it. */
interface RemoteServer {
  readonly [key: string]: unknown
  readonly type: "remote"
  readonly url: string
  readonly oauth: {
    readonly client_id: string
    readonly redirect_uri: string
    readonly scope: string
    readonly client_secret?: string
  }
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined)

/**
 * The MCP server config for one alias. The profile may be empty (all its fields are optional), and then registration
 * reports the missing client id instead of registering a server that can never sign in. A refused credential is never
 * echoed: only the variable's name appears.
 */
export function serverConfig(account: AccountProfile): RemoteServer {
  const profile = account.profile ?? {}
  const alias = account.alias
  const clientId = text(profile["clientId"])
  if (clientId === undefined) {
    throw new Error(`options.accounts.${alias}.clientId is missing: set the OAuth 2.0 client id of the X developer app this alias signs in with`)
  }
  const redirect = text(profile["redirectUri"]) ?? X_REDIRECT_URI
  const secretEnv = text(profile["clientSecretEnv"])
  let secret: string | undefined
  if (secretEnv !== undefined) {
    secret = text(process.env[secretEnv])
    if (secret === undefined) throw new Error(`options.accounts.${alias}.clientSecretEnv names ${secretEnv}, and that environment variable is not set`)
  }
  return {
    type: "remote",
    url: X_ENDPOINT,
    oauth: {
      client_id: clientId,
      redirect_uri: redirect,
      scope: X_SCOPES.join(" "),
      ...(secret === undefined ? {} : { client_secret: secret }),
    },
  }
}

/** The server a person signs in to for one alias. */
export const serverFor = (alias: string) => accountName(PLUGIN, alias)

/** The accounts option, when it cannot be read, as the register's OPTIONS_INVALID message. */
export function optionsError(problems: readonly string[]): Error {
  return new Error(`OPTIONS_INVALID: ${problems.join("; ")}. Next step: fix the plugin's accounts option.`)
}

/** The most X reads one events_list call may make, the account lookup included. */
export function maxCallsOf(manifest: Manifest, options: Readonly<Record<string, unknown>>): number {
  const schema = manifest.options["properties"] as Record<string, Record<string, unknown>> | undefined
  const declared = schema?.["maxCalls"] ?? {}
  const fallback = typeof declared["default"] === "number" ? declared["default"] : 4
  const value = options["maxCalls"]
  if (value === undefined) return fallback
  const minimum = typeof declared["minimum"] === "number" ? declared["minimum"] : 2
  const maximum = typeof declared["maximum"] === "number" ? declared["maximum"] : 20
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`OPTIONS_INVALID: options.maxCalls must be a whole number from ${minimum} to ${maximum}. Next step: set it to a value in that range, or remove it.`)
  }
  return value
}

/** A failure a read reported for one alias. */
export interface ObservedFailure {
  readonly state: "needs_sign_in" | "error"
  readonly reason: string
}

/**
 * What the plugin learned about each alias after `register` returned: the owner a probe answered, and the last failure
 * a read reported. It is not access state and status never invents an alias: an entry is only written for an alias the
 * plugin has, and a successful probe clears the failure.
 */
export interface Observations {
  setOwner(alias: string, owner: Owner): void
  setReady(alias: string): void
  setFailure(alias: string, state: "needs_sign_in" | "error", reason: string): void
  ownerOf(alias: string): Owner | undefined
  failureOf(alias: string): ObservedFailure | undefined
}

/** A fresh, empty observation store for one plugin instance. */
export function createObservations(): Observations {
  const owners = new Map<string, Owner>()
  const failures = new Map<string, ObservedFailure>()
  return {
    setOwner(alias, owner) {
      owners.set(alias, owner)
    },
    setReady(alias) {
      failures.delete(alias)
    },
    setFailure(alias, state, reason) {
      failures.set(alias, { state, reason })
    },
    ownerOf(alias) {
      return owners.get(alias)
    },
    failureOf(alias) {
      return failures.get(alias)
    },
  }
}

/** The signal one alias reports, from its last failure and the server state, or undefined when nothing is known. */
export function signalOf(server: AccountSignal | undefined, failure: ObservedFailure | undefined, owner: Owner | undefined): AccountSignal | undefined {
  const base = failure ?? server
  if (base === undefined) return owner === undefined ? undefined : { state: "ready", owner }
  return {
    state: base.state,
    ...(owner === undefined ? {} : { owner }),
    ...(base.state === "ready" || base.reason === undefined ? {} : { reason: base.reason }),
  }
}

/** The account signal one MCP server state gives: a refused credential is `needs_sign_in`, never an older code. */
export function serverSignal(state: ServerState | undefined): AccountSignal | undefined {
  if (state === undefined) return undefined
  if (state.status === "connected" || state.status === "pending") return { state: "ready" }
  if (state.status === "needs_auth") return { state: "needs_sign_in", reason: state.error ?? "X refused the credential" }
  if (state.status === "disabled") return { state: "error", reason: "the X MCP server is disabled" }
  return { state: "error", reason: state.error ?? "the X MCP server failed" }
}
