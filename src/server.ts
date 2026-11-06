import type { Mcp } from "@opencode/plugin"
import { ENDPOINT } from "./constants.js"
import type { Client } from "./connect.js"
import type { Options } from "./options.js"

type RemoteConfig = Extract<Mcp.ServerConfig, { type: "remote" }>

/**
 * X's hosted MCP server with the user's own X app as a static OAuth client. `redirect_uri` is always explicit: X
 * matches it exactly, and OpenCode otherwise builds an ephemeral loopback port. A loopback redirect leaves
 * `callback_port` out, so OpenCode listens on the redirect's own port; an `https:` redirect sets it, the port a proxy
 * forwards to. `scope` is pinned because X's 401 names none, and `offline.access` is what makes X issue a refresh
 * token. Protocol, timeouts, headers and Code Mode keep the host defaults.
 */
export function serverConfig(options: Options, client: Client, endpoint: string = ENDPOINT): RemoteConfig {
  return {
    type: "remote",
    url: endpoint,
    oauth: {
      client_id: client.id,
      redirect_uri: options.redirectUri,
      ...(options.callbackPort === undefined ? {} : { callback_port: options.callbackPort }),
      scope: options.scopes.join(" "),
      ...(client.secret === undefined ? {} : { client_secret: client.secret }),
    },
  }
}

/** The client as status shows it: a public Native App has no secret, a confidential one does. */
export const clientMode = (client: Client): "public_pkce" | "confidential" => (client.secret === undefined ? "public_pkce" : "confidential")
