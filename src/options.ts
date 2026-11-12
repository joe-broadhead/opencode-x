import { REDIRECT_URI, SCOPES } from "./constants.js"
import type { Access } from "./permissions.js"
import { DEFAULT_FEEDS, DEFAULT_MAX_CALLS, FEEDS, MAX_CALLS, type Feed } from "./events.js"

export interface Options {
  /** Pins the X app, for example in an organisation's managed config. Otherwise the /connect X app entry sets it. */
  readonly clientId?: string
  readonly redirectUri: string
  /** The local port OpenCode's callback listener uses. Set only, and always, with an `https:` redirect. */
  readonly callbackPort?: number
  readonly scopes: readonly string[]
  readonly clientSecret?: string
  readonly allowUntestedHost: boolean
  /** An opt-in per-session spend budget for scripts, in USD. Absent: no budget, X's own billing and limits apply. */
  readonly scriptBudgetUsd?: number
  /** An opt-in rolling 24-hour cap on all script spending, in USD, across sessions, jobs and reloads. Absent: no cap. */
  readonly scriptDailyBudgetUsd?: number
  /** The generated permission block: every tool, reads with changes asking, or reads only. */
  readonly access: Access
  /** True only when the signed-in account owns the developer app, so Owned Read pricing applies. */
  readonly ownsXApp: boolean
  /** The feeds `x_events_list` reads for Memory, in order. */
  readonly feeds: readonly Feed[]
  /** The most X reads one `x_events_list` call makes, the owner's included. */
  readonly maxCalls: number
}

/** A rejected option. Messages name the field and never echo its value. */
interface OptionsError {
  readonly code: "OPTIONS_INVALID"
  readonly field: string
  readonly message: string
  readonly next: string
}

const positiveUsd = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0

type ParsedOptions =
  | { readonly ok: true; readonly options: Options }
  | { readonly ok: false; readonly error: OptionsError }

const TOP_KEYS = ["oauth", "allowUntestedHost", "scriptBudgetUsd", "scriptDailyBudgetUsd", "access", "ownsXApp", "events"]
const EVENTS_KEYS = ["feeds", "maxCalls"]
const OAUTH_KEYS = ["client_id", "redirect_uri", "callback_port", "scopes", "client_secret"]
const NO_SPACES = /^\S+$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const fail = (field: string, message: string, next: string): ParsedOptions =>
  ({ ok: false, error: { code: "OPTIONS_INVALID", field, message, next } })

/**
 * A loopback `http:` redirect, where OpenCode listens on the URL's own port, or an `https:` one that a proxy
 * forwards to OpenCode's listener on `oauth.callback_port`. Both need a path, which the listener matches.
 */
function redirectProblem(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "Must be a valid URL."
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Must use http: or https:."
  if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return "An http: URL must use the host localhost or 127.0.0.1."
  }
  if (url.protocol === "http:" && url.port === "") return "An http: URL must include an explicit port."
  if (url.username !== "" || url.password !== "") return "Must not include credentials."
  if (value.includes("?") || value.includes("#")) return "Must not include a query or fragment."
  if (url.pathname === "/") return "Must include a path, such as /callback."
  return undefined
}

const isPort = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535

export function parseOptions(input: unknown): ParsedOptions {
  const raw = input ?? {}
  if (!isRecord(raw)) return fail("options", "Plugin options must be an object.", "Set options to an object, or remove them.")
  const unknownKey = Object.keys(raw).find((key) => !TOP_KEYS.includes(key))
  if (unknownKey !== undefined) {
    return fail(unknownKey, "This option is not supported.", `Remove it. Supported options: ${TOP_KEYS.join(", ")}.`)
  }

  const oauth = raw.oauth ?? {}
  if (!isRecord(oauth)) return fail("oauth", "Must be an object.", "Set oauth to an object such as { \"client_id\": \"...\" }.")
  const unknownOAuthKey = Object.keys(oauth).find((key) => !OAUTH_KEYS.includes(key))
  if (unknownOAuthKey !== undefined) {
    return fail(`oauth.${unknownOAuthKey}`, "This option is not supported.", `Remove it. Supported oauth options: ${OAUTH_KEYS.join(", ")}.`)
  }

  const clientId = oauth.client_id
  if (clientId !== undefined && (typeof clientId !== "string" || !NO_SPACES.test(clientId))) {
    return fail("oauth.client_id", "Must be a non-empty string without spaces.", "Copy the client ID from your X app's User authentication settings at console.x.com.")
  }

  const redirectUri = oauth.redirect_uri ?? REDIRECT_URI
  const redirectError = typeof redirectUri === "string" ? redirectProblem(redirectUri) : "Must be a string."
  if (typeof redirectUri !== "string" || redirectError !== undefined) {
    return fail("oauth.redirect_uri", redirectError ?? "Must be a string.", `Use a URL registered in your X app's User authentication settings, for example ${REDIRECT_URI}.`)
  }

  const hosted = new URL(redirectUri).protocol === "https:"
  const callbackPort = oauth.callback_port
  if (callbackPort !== undefined && !isPort(callbackPort)) {
    return fail("oauth.callback_port", "Must be a whole number from 1 to 65535.", "Set it to the local port that receives the forwarded callback, for example 8767.")
  }
  if (callbackPort !== undefined && !hosted) {
    return fail("oauth.callback_port", "Applies only to an https: oauth.redirect_uri.", "Remove it: with a loopback oauth.redirect_uri, OpenCode listens on that URL's port.")
  }
  if (callbackPort === undefined && hosted) {
    return fail("oauth.callback_port", "Must be set with an https: oauth.redirect_uri.", "Set it to the local port your proxy forwards the redirect to, for example 8767.")
  }

  const scopes: unknown = oauth.scopes ?? SCOPES
  const isScope = (scope: unknown): scope is string => typeof scope === "string" && NO_SPACES.test(scope)
  if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every(isScope)) {
    return fail("oauth.scopes", "Must be a non-empty list of scope names without spaces.", `List X OAuth 2.0 scopes, for example ${JSON.stringify(SCOPES)}.`)
  }
  if (new Set(scopes).size !== scopes.length) return fail("oauth.scopes", "Lists a scope more than once.", "Remove the duplicate scope.")

  const clientSecret = oauth.client_secret
  if (clientSecret !== undefined && (typeof clientSecret !== "string" || clientSecret === "")) {
    return fail("oauth.client_secret", "Must be a non-empty string.", "Set it to {env:X_CLIENT_SECRET} and export that variable, or remove it for a Native App.")
  }
  if (clientSecret !== undefined && clientId === undefined) {
    return fail("oauth.client_secret", "Needs oauth.client_id.", "Set oauth.client_id to your X app's client ID, or remove oauth.client_secret.")
  }

  const allowUntestedHost = raw.allowUntestedHost ?? false
  if (typeof allowUntestedHost !== "boolean") {
    return fail("allowUntestedHost", "Must be true or false.", "Set it to true only to run on an OpenCode version outside the supported range.")
  }

  // Both budgets are opt-in: unset (or null) means none, and X's own billing and app spending limit apply. A number the
  // user sets, however large, is their choice; only something that is not a positive amount of dollars is refused.
  const scriptBudgetUsd = raw.scriptBudgetUsd ?? undefined
  if (scriptBudgetUsd !== undefined && !positiveUsd(scriptBudgetUsd)) {
    return fail("scriptBudgetUsd", "Must be a number greater than 0, or unset for no budget.", "Set the per-session spend budget in US dollars, for example 1.00, or remove it.")
  }

  const scriptDailyBudgetUsd = raw.scriptDailyBudgetUsd ?? undefined
  if (scriptDailyBudgetUsd !== undefined && !positiveUsd(scriptDailyBudgetUsd)) {
    return fail("scriptDailyBudgetUsd", "Must be a number greater than 0, or unset for no cap.", "Set the rolling 24-hour spend cap in US dollars, for example 5.00, or remove it.")
  }

  const accessValue = raw.access ?? "all"
  if (accessValue !== "all" && accessValue !== "ask-changes" && accessValue !== "read-only") {
    return fail("access", "Must be \"all\", \"ask-changes\" or \"read-only\".", "Use \"ask-changes\" to keep reads and ask for every other tool, or \"read-only\" to deny them.")
  }
  const access = accessValue as Access
  const ownsXApp = raw.ownsXApp ?? false
  if (typeof ownsXApp !== "boolean") return fail("ownsXApp", "Must be true or false.", 'Set it to true only if the signed-in X account owns the developer app.')

  const events = raw.events ?? {}
  if (!isRecord(events)) return fail("events", "Must be an object.", 'Set events to an object such as { "feeds": ["mentions", "bookmarks"], "maxCalls": 4 }.')
  const unknownEventsKey = Object.keys(events).find((key) => !EVENTS_KEYS.includes(key))
  if (unknownEventsKey !== undefined) {
    return fail(`events.${unknownEventsKey}`, "This option is not supported.", `Remove it. Supported events options: ${EVENTS_KEYS.join(", ")}.`)
  }
  const feeds: unknown = events.feeds ?? DEFAULT_FEEDS
  if (!Array.isArray(feeds) || feeds.length === 0 || !feeds.every((feed) => (FEEDS as readonly unknown[]).includes(feed))) {
    return fail("events.feeds", `Must be a non-empty list of ${FEEDS.join(", ")}.`, `List the feeds Memory collects, for example ${JSON.stringify(DEFAULT_FEEDS)}.`)
  }
  if (new Set(feeds).size !== feeds.length) return fail("events.feeds", "Lists a feed more than once.", "Remove the duplicate feed.")
  const maxCalls = events.maxCalls ?? DEFAULT_MAX_CALLS
  if (typeof maxCalls !== "number" || !Number.isInteger(maxCalls) || maxCalls < MAX_CALLS.min || maxCalls > MAX_CALLS.max) {
    return fail("events.maxCalls", `Must be a whole number from ${MAX_CALLS.min} to ${MAX_CALLS.max}.`, `Set it to the most billed X reads one collection call may make, ${DEFAULT_MAX_CALLS} by default.`)
  }

  return {
    ok: true,
    options: {
      ...(clientId === undefined ? {} : { clientId }),
      redirectUri,
      ...(callbackPort === undefined ? {} : { callbackPort }),
      scopes: [...scopes],
      ...(clientSecret === undefined ? {} : { clientSecret }),
      allowUntestedHost,
      ...(scriptBudgetUsd === undefined ? {} : { scriptBudgetUsd }),
      ...(scriptDailyBudgetUsd === undefined ? {} : { scriptDailyBudgetUsd }),
      access,
      ownsXApp,
      feeds: [...feeds] as Feed[],
      maxCalls,
    },
  }
}
