// X's failures, in the contract's one form (contract §12).
//
// A handler may throw any error carrying `code`, `what` and `next`; the contract's register maps it to the table and
// redacts both sentences. This module keeps that shape, so a provider refusal and a handler refusal read the same. The
// precise cause is one line, cut and redacted: a token or a signed URL never reaches status, a log line or a model.
import type { ErrorCode } from "@we-the-rebel-alliance/plugin-contract/events"

/** A read that did not run: the contract's code, what happened, and what to do next. */
export class ProviderError extends Error {
  readonly code: ErrorCode
  readonly what: string
  readonly next: string

  constructor(code: ErrorCode, what: string, next: string) {
    const clean = what.replace(/[.\s]+$/, "")
    super(`${code}: ${clean}. Next step: ${next}`)
    this.name = "ProviderError"
    this.code = code
    this.what = clean
    this.next = next
  }
}

/** The four ways the host reports a refused or unreachable X server. */
export type ServerStatus = "connected" | "pending" | "disabled" | "failed" | "needs_auth"

/** One MCP server as the host lists it. */
export interface ServerState {
  readonly name: string
  readonly status: ServerStatus
  readonly error?: string
}

/** The sign-in sentence for an alias and its server. */
export const signInNext = (server: string) => `Sign in to X for this account: run /connect and choose ${server}, or opencode mcp auth ${server}.`
