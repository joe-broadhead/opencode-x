// The plugin's one handler table. `src/index.ts` passes it to `contract.register`, which wires every door from it.
//
// Three methods are the plugin's own: `status`, `probe` and `events_list`. X's 101 MCP tools are declared in the
// manifest as `mcp:<tool>` and have no handler: the vendor's server owns them.
import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Observations } from "../accounts.js"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { Provider } from "../provider/index.js"
import { eventsListHandler } from "./events_list.js"
import { probeHandler } from "./probe.js"
import { statusHandler } from "./status.js"

export interface HandlerDeps {
  readonly manifest: Manifest
  readonly version: string
  readonly hostVersion: string
  readonly profiles: Parameters<typeof statusHandler>[0]["profiles"]
  readonly provider: Provider
  readonly observations: Observations
  readonly maxCalls: number
  readonly now: () => number
  readonly problems: () => readonly string[]
}

/** Every handler, by the method name the manifest declares. */
export function createHandlers(deps: HandlerDeps): HandlerTable {
  return {
    status: statusHandler(deps),
    probe: probeHandler(deps),
    events_list: eventsListHandler(deps),
  }
}
