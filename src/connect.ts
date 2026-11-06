import type { Plugin } from "@opencode/plugin"
import type { Options } from "./options.js"

type Context = Plugin.Context

/** The X app OpenCode signs in with. `secret` is set for a confidential (Web App) X app. */
export interface Client {
  readonly id: string
  readonly secret?: string
  readonly source: "options" | "connect"
}

/** The client in use. Without one, `invalid` tells whether a stored entry was unusable or nothing is stored. */
export interface ClientState {
  readonly client?: Client
  readonly invalid: boolean
}

const NO_SPACES = /^\S+$/

/** The `/connect` entry that stores an X app's client ID. */
const APP_INTEGRATION_ID = "x-app"
/** The name `/connect` shows for the entry that stores the client ID. */
export const APP_NAME = "X app"
/** The name `/connect` shows for the X MCP server's own integration. */
export const SERVER_DISPLAY_NAME = "X"

/**
 * Adds "X app" to `/connect`: a key method whose key is the client ID, because OpenCode asks for a non-empty key.
 * The optional secret is a form field, for a confidential (Web App) X app; a Native App is a public client with no
 * secret. Both are kept in OpenCode's credential store, never in the plugin's options or status.
 */
export function registerAppIntegration(integration: Pick<Context["integration"], "transform">) {
  return integration.transform((editor) => {
    editor.update(APP_INTEGRATION_ID, (draft) => {
      draft.name = APP_NAME
    })
    editor.method.update({
      integrationID: APP_INTEGRATION_ID,
      method: {
        type: "key",
        label: "X app client ID",
        form: [{
          key: "client_secret",
          type: "string",
          title: "Client secret",
          description: "Only for a confidential (Web App) X app. Skip it for a Native App, which has no secret.",
          required: false,
        }],
      },
    })
  })
}

/** Options first, then the client stored through `/connect`. No client ships with the plugin. */
export async function resolveClient(integration: { readonly connection: Pick<Context["integration"]["connection"], "active" | "resolve" | "status"> }, options: Options): Promise<ClientState> {
  if (options.clientId !== undefined) {
    return { client: { id: options.clientId, ...(options.clientSecret === undefined ? {} : { secret: options.clientSecret }), source: "options" }, invalid: false }
  }
  const integrationID = APP_INTEGRATION_ID
  const connection = await integration.connection.active(integrationID)
  const stored = connection === undefined ? undefined : await integration.connection.resolve(connection)
  if (connection !== undefined && stored?.type === "key") {
    const id = stored.key.trim()
    const valid = NO_SPACES.test(id)
    // `/connect` then shows the saved entry as needing a new sign-in.
    await integration.connection.status({
      integrationID,
      connection,
      status: valid ? undefined : { status: "needs_auth", message: "This is not an X client ID: it is empty or has spaces." },
    }).catch(() => undefined)
    if (!valid) return { invalid: true }
    const secret = typeof stored.metadata?.client_secret === "string" ? stored.metadata.client_secret.trim() : ""
    return { client: { id, ...(secret === "" ? {} : { secret }), source: "connect" }, invalid: false }
  }
  return { invalid: false }
}

export const sameClient = (a: ClientState, b: ClientState) => JSON.stringify(a) === JSON.stringify(b)
