// `status`: the plugin's identity, host range, every alias and the agents its rules miss.
//
// No X read happens here, so status costs nothing. Each alias's state comes from OpenCode's own MCP server state and,
// after a call, from what the last provider read reported: a refused credential is `needs_sign_in`, with a redacted
// reason. The answer is the contract's `statusAnswer`, so no shape is copied and no state is written after register.
import { accountStatuses, redactReason, STATUS_SCHEMA, statusAnswer, type AccountProfile, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { serverFor, serverSignal, signalOf, type Observations } from "../accounts.js"
import type { Provider } from "../provider/index.js"
import type { ServerState } from "../provider/errors.js"
import { EMPTY } from "./shared.js"

export const STATUS_DESCRIPTION =
  "Read the plugin's state: its host range, every X account alias with its sign-in state and owner, and the agents the " +
  "access rules do not cover. It makes no X read and costs nothing."

export interface StatusDeps {
  readonly manifest: Manifest
  readonly version: string
  readonly hostVersion: string
  readonly profiles: readonly AccountProfile[]
  readonly provider: Provider
  readonly observations: Observations
  /** Why registering the accounts did not fully succeed; read at the call, never kept after it. */
  readonly problems: () => readonly string[]
}

/** The `status` handler. */
export function statusHandler(deps: StatusDeps) {
  return {
    description: STATUS_DESCRIPTION,
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input: Readonly<Record<string, unknown>>, call: { unguardedAgents(): Promise<{ readonly ok: true; readonly agents: readonly string[] } | { readonly ok: false; readonly error: string }> }) {
      const problems = [...deps.problems()]
      let servers: readonly ServerState[] = []
      try {
        servers = await deps.provider.servers()
      } catch (error) {
        problems.push(`the OpenCode MCP server list could not be read: ${redactReason(error instanceof Error ? error.message : String(error))}`)
      }
      const byName = new Map(servers.map((server) => [server.name, server] as const))
      const signals: Record<string, AccountSignal | undefined> = {}
      for (const profile of deps.profiles) {
        signals[profile.alias] = signalOf(serverSignal(byName.get(serverFor(profile.alias))), deps.observations.failureOf(profile.alias), deps.observations.ownerOf(profile.alias))
      }
      return statusAnswer({
        manifest: deps.manifest,
        version: deps.version,
        hostVersion: deps.hostVersion,
        accounts: accountStatuses(deps.profiles, signals),
        problems,
        unguardedAgents: await call.unguardedAgents(),
      })
    },
  }
}
