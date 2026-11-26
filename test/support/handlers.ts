// The handler table with a synthetic provider, and a `MethodCall` the handlers accept.
import { accountsOf, type AccountProfile } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { createObservations } from "../../src/accounts.js"
import { createHandlers } from "../../src/handlers/index.js"
import { manifest } from "../../src/manifest.js"
import { createFakeX, type FakeX } from "./fake-x.js"

/** Every page this suite records is read at this fixed moment. */
export const NOW = Date.parse("2026-11-25T12:00:00.000Z")

export interface Harness {
  readonly handlers: ReturnType<typeof createHandlers>
  readonly fake: FakeX
  readonly observations: ReturnType<typeof createObservations>
  readonly profiles: readonly AccountProfile[]
  call(account?: string, extra?: Partial<MethodCall>): MethodCall
}

/** The handler table for the two invented aliases, with a fixed clock. */
export function harness(options: { readonly accounts?: Record<string, Record<string, unknown>>; readonly maxCalls?: number } = {}): Harness {
  const settings = { accounts: options.accounts ?? { work: {}, personal: {} } }
  const plan = accountsOf(manifest, settings)
  if (!plan.ok) throw new Error(plan.problems.join("; "))
  const observations = createObservations()
  const fake = createFakeX()
  const handlers = createHandlers({
    manifest,
    version: "0.0.0",
    hostVersion: "2.4.1",
    profiles: plan.value.accounts,
    provider: fake,
    observations,
    maxCalls: options.maxCalls ?? 4,
    now: () => NOW,
    problems: () => [],
  })
  return {
    handlers,
    fake,
    observations,
    profiles: plan.value.accounts,
    call(account = "work", extra = {}) {
      return {
        sessionID: "ses_fixture",
        agent: "build",
        messageID: "msg_fixture",
        id: "call_fixture",
        signal: new AbortController().signal,
        progress: async () => undefined,
        account,
        bus: {} as MethodCall["bus"],
        unguardedAgents: async () => ({ ok: true, agents: [] }),
        door: "tool",
        ...extra,
      }
    },
  }
}
