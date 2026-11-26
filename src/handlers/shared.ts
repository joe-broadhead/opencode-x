// What the plugin's own methods share: an empty input, the owner a probe and a page name, and the observation a
// provider failure leaves for status.
import { redactReason } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { Observations } from "../accounts.js"
import { ProviderError } from "../provider/errors.js"
import type { XUser } from "../provider/parse.js"

/** An input that takes nothing. */
export const EMPTY = { type: "object", properties: {}, additionalProperties: false } as const

/** One line of at most `max` characters, ending in `…`, never splitting a surrogate pair. */
function oneLine(text: string, max: number): string {
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  let end = max - 1
  const code = clean.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return `${clean.slice(0, end)}…`
}

/** The owner a page and a probe name: `x:@handle`, labelled with the person's name when X returns one. */
export function ownerOf(user: XUser): Owner {
  return {
    id: `x:@${user.username.toLowerCase()}`,
    label: oneLine(user.name === undefined ? `@${user.username}` : `${user.name} (@${user.username})`, 200),
  }
}

/** Remember a provider failure for status: a refused credential is `needs_sign_in`, anything else is `error`. */
export function observeFailure(observations: Observations, alias: string, error: unknown): void {
  if (!(error instanceof ProviderError)) return
  const reason = redactReason(error.what)
  observations.setFailure(alias, error.code === "NEEDS_SIGN_IN" ? "needs_sign_in" : "error", reason)
}

/** Remember a successful identity read: the owner, and no outstanding failure. */
export function observeOwner(observations: Observations, alias: string, user: XUser): void {
  observations.setOwner(alias, ownerOf(user))
  observations.setReady(alias)
}

/** The contract's cost for one page or probe: the counts X returned, per its price units. */
export function costUnits(counts: { readonly posts: number; readonly authors: number; readonly users: number }): { units: { per: string; count: number }[] } {
  return {
    units: [
      ...(counts.posts > 0 ? [{ per: "post", count: counts.posts }] : []),
      ...(counts.authors > 0 ? [{ per: "author", count: counts.authors }] : []),
      ...(counts.users > 0 ? [{ per: "user", count: counts.users }] : []),
    ],
  }
}
