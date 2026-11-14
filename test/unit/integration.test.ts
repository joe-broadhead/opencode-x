// The /connect entry: renamed "X" once the host has registered it and again after the host resets it, and the
// account marked for a new sign-in while the server needs one. Against a narrow fake of the members the watcher uses.
import { describe, expect, test } from "bun:test"
import { watchIntegration, type IntegrationContext } from "../../src/integration.js"

type Editor = Parameters<Parameters<IntegrationContext["integration"]["transform"]>[0]>[0]
type Connection = { type: "credential"; id: string; label: string; method: "oauth"; status?: { status: "needs_auth"; message: string } }

function fake(initial: { server?: string; integrationID?: string } = {}) {
  const state = {
    server: initial.server ?? "connected",
    integrationID: "integrationID" in initial ? initial.integrationID : "mcp_x",
    /** The host's name for each integration before plugin transforms run. */
    hostName: "x",
    connection: undefined as Connection | undefined,
    /** The `scope` OpenCode stored with the credential, as X granted it. */
    granted: undefined as string | undefined,
    /** Accounts other than the active one, such as the one an earlier sign-in left. */
    others: [] as Connection[],
  }
  const transforms: ((editor: Editor) => void)[] = []
  const reported: unknown[] = []
  let push: (() => void) | undefined
  const name = () => {
    let current = state.hostName
    const editor = {
      get: (id: string) => (id === state.integrationID ? { id, name: current } : undefined),
      update: (id: string, update: (integration: { id: string; name: string }) => void) => {
        const integration = { id, name: current }
        update(integration)
        current = integration.name
      },
    } as unknown as Editor
    for (const transform of transforms) transform(editor)
    return current
  }
  const ctx = {
    mcp: { list: async () => ({ data: [{ name: "x", status: { status: state.server }, ...(state.integrationID ? { integrationID: state.integrationID } : {}) }] }) },
    integration: {
      transform: async (callback: (editor: Editor) => void) => {
        transforms.push(callback)
        return { dispose: async () => void transforms.splice(transforms.indexOf(callback), 1) }
      },
      // The host projects each credential with the status the plugin set on it; `active` returns the credential alone.
      get: async () => ({
        data: {
          id: state.integrationID,
          name: name(),
          connections: [...(state.connection ? [state.connection] : []), ...state.others].map((item) => ({ type: "credential", id: item.id, label: item.label, method: item.method, ...(item.status ? { status: item.status } : {}) })),
        },
      }),
      connection: {
        active: async () => state.connection,
        resolve: async () => (state.connection ? { type: "oauth", access: "secret", refresh: "secret", expires: 0, metadata: state.granted === undefined ? {} : { scope: state.granted } } : undefined),
        status: async (input: { connection: { id: string }; status: Connection["status"] }) => {
          const apply = (item: Connection): Connection => (item.id === input.connection.id ? { ...item, status: input.status } : item)
          if (state.connection?.id === input.connection.id) reported.push(input.status)
          else reported.push({ account: input.connection.id, status: input.status })
          if (state.connection) state.connection = apply(state.connection)
          state.others = state.others.map(apply)
        },
      },
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          while (!signal.aborted) {
            await new Promise<void>((resolve) => {
              push = resolve
              signal.addEventListener("abort", () => resolve(), { once: true })
            })
            if (!signal.aborted) yield { type: "integration.updated", data: {} }
          }
        },
      }),
    },
  } as unknown as IntegrationContext
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
  return { ctx, state, transforms, reported, name, emit: () => push?.(), settle }
}

const SIGN_IN_AGAIN = "X needs a new sign-in. Choose this account to sign in again."

describe("watchIntegration", () => {
  test("names the server's /connect entry X once the host has registered it", async () => {
    const view = fake({ integrationID: undefined })
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    expect(view.transforms).toHaveLength(0)
    view.state.integrationID = "mcp_x"
    view.emit()
    await view.settle()
    expect(view.name()).toBe("X")
    expect(view.transforms).toHaveLength(1)
    await stop()
    expect(view.transforms).toHaveLength(0)
  })

  test("registers the rename again when the host's name comes back, and drops the old one", async () => {
    const view = fake()
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    expect(view.name()).toBe("X")
    // An MCP reload registers the host's transform again, after the plugin's: the name is reset.
    view.transforms.push((editor) => editor.update("mcp_x", (integration) => void (integration.name = "x")))
    view.emit()
    await view.settle()
    expect(view.name()).toBe("X")
    expect(view.transforms).toHaveLength(2)
    await stop()
  })

  test("leaves a server that is not X's alone", async () => {
    const view = fake()
    const stop = watchIntegration(view.ctx, () => false)
    await view.settle()
    expect(view.transforms).toHaveLength(0)
    await stop()
  })

  test("marks the account for a new sign-in while the server needs one, and clears only its own mark", async () => {
    const view = fake({ server: "needs_auth" })
    view.state.connection = { type: "credential", id: "c1", label: "Example Recruiter", method: "oauth" }
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    expect(view.reported).toEqual([{ status: "needs_auth", message: SIGN_IN_AGAIN }])
    view.state.server = "connected"
    view.emit()
    await view.settle()
    expect(view.reported).toEqual([{ status: "needs_auth", message: SIGN_IN_AGAIN }, undefined])
    view.state.connection = { ...view.state.connection!, status: { status: "needs_auth", message: "Another plugin's problem." } }
    view.emit()
    await view.settle()
    expect(view.reported).toHaveLength(2)
    await stop()
  })

  test("marks a connected account whose granted scopes lack one the plugin asks for, and clears it once granted", async () => {
    const requested = ["tweet.read", "media.write", "offline.access"]
    const view = fake()
    view.state.connection = { type: "credential", id: "c1", label: "Example Recruiter", method: "oauth" }
    view.state.granted = "tweet.read offline.access"
    const stop = watchIntegration(view.ctx, () => true, () => requested)
    await view.settle()
    const lacks = { status: "needs_auth", message: "X's sign-in lacks the scopes this version asks for: media.write. Choose this account to sign in again." }
    expect(view.reported).toEqual([lacks])
    // The person signs in again and X grants the new scope: the mark is the plugin's own, so it clears it.
    view.state.granted = "tweet.read media.write offline.access"
    view.emit()
    await view.settle()
    expect(view.reported).toEqual([lacks, undefined])
    await stop()
  })

  test("claims nothing about scopes when the grant is unknown, or for a server that is not the plugin's own", async () => {
    const view = fake()
    view.state.connection = { type: "credential", id: "c1", label: "Example Recruiter", method: "oauth" }
    const stop = watchIntegration(view.ctx, () => true, () => ["media.write"])
    await view.settle()
    view.state.granted = "tweet.read"
    const adopted = watchIntegration(view.ctx, () => true, () => undefined)
    await view.settle()
    await adopted()
    await stop()
    expect(view.reported).toEqual([])
  })

  test("clears its own mark on an account an earlier sign-in left, and no other plugin's", async () => {
    const view = fake()
    const lacks = { status: "needs_auth" as const, message: "X's sign-in lacks the scopes this version asks for: media.write. Choose this account to sign in again." }
    view.state.connection = { type: "credential", id: "c2", label: "X 2", method: "oauth" }
    view.state.granted = "tweet.read media.write"
    view.state.others = [
      { type: "credential", id: "c1", label: "X", method: "oauth", status: lacks },
      { type: "credential", id: "c0", label: "X 0", method: "oauth", status: { status: "needs_auth", message: "Another plugin's problem." } },
    ]
    const stop = watchIntegration(view.ctx, () => true, () => ["tweet.read", "media.write"])
    await view.settle()
    expect(view.reported).toEqual([{ account: "c1", status: undefined }])
    expect(view.state.others.map((item) => item.status?.message)).toEqual([undefined, "Another plugin's problem."])
    await stop()
  })
})
