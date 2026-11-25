// `probe`: who is signed in for an alias, and nothing it reads.
//
// One billed `get_users_me` read names the account's owner. A caller that names a source gets its page name back, so a
// host binding a source can probe that source; no post, message or bookmark is read.
import { parseProbeInput, probeResult, PROBE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import { refusal, RegisterError } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Observations } from "../accounts.js"
import { FEEDS, type Feed, type Provider } from "../provider/index.js"
import { costUnits, observeFailure, observeOwner, ownerOf } from "./shared.js"

/** The probe's input: the source whose page name it answers. The register adds `account`. */
export const PROBE_INPUT = {
  type: "object",
  properties: {
    source: {
      type: "string",
      enum: [...FEEDS],
      description: "The feed to answer for: mentions, bookmarks or timeline. Omit it for mentions.",
    },
  },
  additionalProperties: false,
} as const

export const PROBE_DESCRIPTION =
  "Read which X account is signed in for this alias and its owner, and nothing else. It makes one billed user read, and " +
  "reads no post, message or bookmark."

const isFeed = (value: string): value is Feed => (FEEDS as readonly string[]).includes(value)

/** The `probe` handler. */
export function probeHandler(deps: { readonly provider: Provider; readonly observations: Observations }) {
  return {
    description: PROBE_DESCRIPTION,
    input: PROBE_INPUT,
    output: PROBE_SCHEMA,
    async run(input: Readonly<Record<string, unknown>>, call: { readonly account: string; readonly signal: AbortSignal }) {
      const parsed = parseProbeInput(input)
      if (!parsed.ok) {
        throw new RegisterError(refusal("INPUT_INVALID", `the probe input is invalid: ${parsed.problems.join("; ")}`, "Pass only source, as probe's schema describes it."))
      }
      const source = parsed.value.source ?? FEEDS[0]
      if (!isFeed(source)) {
        throw new RegisterError(refusal("SOURCE_UNKNOWN", `x has no source ${source}`, `Pass one of ${FEEDS.map((feed) => `"${feed}"`).join(", ")}, or leave "source" out.`))
      }
      try {
        const answer = await deps.provider.me(call.account, call)
        observeOwner(deps.observations, call.account, answer.user)
        return probeResult(
          { source, account: call.account, owner: ownerOf(answer.user) },
          { cost: costUnits({ posts: 0, authors: 0, users: 1 }) },
        )
      } catch (error) {
        observeFailure(deps.observations, call.account, error)
        throw error
      }
    },
  }
}
