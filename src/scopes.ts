/**
 * The scopes X granted the active sign-in, against the ones the plugin asks for. OpenCode keeps the `scope` of X's
 * token response with the credential; only that field is read, never a token. A sign-in made before a version that
 * asks for a new scope lacks it, and X refuses the tools that need it until the person signs in again.
 */

/** The granted scopes OpenCode stored with the credential, or undefined when it stored none. */
export function grantedScopes(credential: unknown): readonly string[] | undefined {
  if (!credential || typeof credential !== "object") return undefined
  const metadata = (credential as { readonly metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object") return undefined
  const scope = (metadata as { readonly scope?: unknown }).scope
  if (typeof scope !== "string" || scope.trim() === "") return undefined
  return scope.trim().split(/\s+/)
}

/** The granted scopes of a connection, read through OpenCode's `resolve`; undefined when it cannot be read. */
export async function readGranted<C>(resolve: (connection: C) => Promise<unknown>, connection: C): Promise<readonly string[] | undefined> {
  try {
    return grantedScopes(await resolve(connection))
  } catch {
    return undefined
  }
}

/** The requested scopes the sign-in was not granted; none when the granted ones are unknown. */
export function missingScopes(requested: readonly string[], granted: readonly string[] | undefined): readonly string[] {
  return granted === undefined ? [] : requested.filter((scope) => !granted.includes(scope))
}

/** What `/connect` shows on the account while its sign-in lacks a scope the plugin asks for. */
export const SCOPES_AGAIN_PREFIX = "X's sign-in lacks the scopes this version asks for:"

export const scopesAgain = (missing: readonly string[]) => `${SCOPES_AGAIN_PREFIX} ${missing.join(" ")}. Choose this account to sign in again.`
