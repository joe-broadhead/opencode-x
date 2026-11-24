/**
 * X's part of the tools RPC (`x.posts.tools`): the plugin value and the method table that the source contract's
 * `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport every plugin of the family shares:
 *
 *   POST /api/rpc/x.posts.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the tool's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. An MCP method then runs through OpenCode's own executor, which checks `x_<tool>`
 * against the same rules and sends OpenCode's own credential; `events_list` and `probe` run their own specs.
 * `docs/scripting.md` describes the calls.
 */
import type { Failure, McpResult, MethodSpec, NextSteps, ShapeCall, ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { toolsRpcId } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { assertBudget, BudgetExceededError, estimateCall, hasBudget, PriceUnknownError, recordCall, rememberEstimate, resetBilling, scriptCostOfCall, spentOf, takeEstimate, unpricedLine } from "./billing.js"
import { priceOf } from "./prices.js"
import { PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { SENSITIVE_TOOLS, PRIVATE_READ_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "./x-tools.js"

/** The RPC's id: the plugin's id and `.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Every known X tool, by its upstream name, with its class: the 51 reads, the 9 private writes, the public
 * `create_posts` (a send, because it reaches everyone), and the 40 privacy-sensitive tools for DMs, follows, mutes
 * and live video (six reads and 34 destructive actions). The class is what `describe` reports and what an approval
 * shows; the rules, not the class, decide whether a call runs. A tool X adds later is not a method. The plugin's own
 * `events_list` and `probe` are added beside them where the RPC is registered.
 */
export const METHODS: readonly MethodSpec[] = [
  ...READ_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "read" })),
  ...WRITE_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "write" })),
  ...PUBLIC_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "send" })),
  ...SENSITIVE_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: PRIVATE_READ_TOOLS.includes(name) ? "read" : "destructive" })),
]

/** Forgets every session's recorded spend and the daily ledger. The tests use it. */
export function resetScriptSpend(): void {
  resetBilling()
}

/**
 * A script call's input, as on the model path: passed to X unchanged, page size and next-page token included, since X
 * validates them against its own limits. It prices the call and, only when the user set a script budget, refuses it
 * before dispatch when the estimate does not fit the session or the rolling daily cap.
 */
export function shapeInput(method: string, input: unknown, call: ShapeCall, owns?: boolean): unknown {
  // X publishes no price for it: a budget cannot be checked, so with one set it is refused; without one it runs.
  if (priceOf(method) === undefined) {
    if (hasBudget()) throw new PriceUnknownError(method)
    takeEstimate(call.sessionID)
    return input
  }
  // The input passes to X unchanged, page size and next-page token included; the estimate prices the page asked for.
  const estimate = estimateCall(method, input, owns)
  assertBudget(call.sessionID, estimate.estimateUsd)
  rememberEstimate(call.sessionID, estimate)
  return input
}

/**
 * A script result's cost: the actual cost from what X returned (the estimate when it reports no usage), recorded
 * against the session and the rolling daily ledger, the cost line, and the structured `cost` beside the output. The
 * model path carries no cost line, because the plugin registers no hook; a script has no program either, so each call
 * gets its own line.
 */
export function shapeResult(method: string, result: McpResult, call: ShapeCall, owns?: boolean): McpResult {
  if (priceOf(method) === undefined) {
    takeEstimate(call.sessionID)
    const spent = spentOf(call.sessionID)
    const unknown = { estimateUsd: null, actualUsd: null, sessionSpentUsd: spent.sessionSpentUsd, dailySpentUsd: spent.dailySpentUsd, basis: "unknown" }
    const output = result.output && typeof result.output === "object" && !Array.isArray(result.output) ? { ...(result.output as Record<string, unknown>), cost: unknown } : { cost: unknown }
    const line = unpricedLine(method)
    return { ...result, output, text: result.text === "" ? line : `${result.text}\n${line}` }
  }
  const estimate = takeEstimate(call.sessionID) ?? estimateCall(method, {}, owns)
  const cost = scriptCostOfCall(method, {}, result, estimate, owns)
  recordCall(call.sessionID, cost.actualUsd)
  const spent = spentOf(call.sessionID)
  const costValue = { estimateUsd: estimate.estimateUsd, actualUsd: cost.actualUsd, sessionSpentUsd: spent.sessionSpentUsd, dailySpentUsd: spent.dailySpentUsd, basis: cost.basis }
  const output = result.output && typeof result.output === "object" && !Array.isArray(result.output) ? { ...(result.output as Record<string, unknown>), cost: costValue } : { cost: costValue }
  return { ...result, output, text: result.text === "" ? cost.line : `${result.text}\n${cost.line}` }
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  SERVER_CONFLICT: `Run /x-status, then point your own mcp.servers.${SERVER_NAME} in opencode.json at the URL it names or remove it, and restart OpenCode.`,
  AUTH_REQUIRED: "Run `/connect` and choose X, then press `o` or Enter to open the link (in a terminal, `opencode mcp auth x` opens it automatically).",
  CONNECTING: "Wait a few seconds, then call the method again.",
  CONNECTION_FAILED: "Check your network, then run /x-status and follow its next step.",
  DISABLED: `Enable the ${SERVER_NAME} server in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`,
  NOT_REGISTERED: "Run /x-status and follow its next step.",
  TOOL_UNAVAILABLE: "Call describe to see which methods OpenCode lists now, and run /x-status.",
  UPSTREAM_ERROR: "Check the input against the method's schema from describe; if X reports a rate limit, wait for the reset it returns, and make fewer calls.",
  CANCELLED: "Call the method again if you still need the result.",
}

/** The plugin's own errors: an unpriced method, or a call that does not fit the budget, each with its next step. */
export function pluginError(error: unknown): Failure | undefined {
  if (error instanceof PriceUnknownError) {
    return {
      code: "X_PRICE_UNKNOWN",
      what: `${error.method} has no published X price, so with a script budget set it is refused: its cost cannot be checked against the budget`,
      next: "Use a priced method, or remove scriptBudgetUsd and scriptDailyBudgetUsd to run it under X's own billing.",
    }
  }
  if (error instanceof BudgetExceededError) {
    const left: string[] = []
    if (error.sessionBudgetUsd !== undefined) left.push(`the session has $${Math.max(0, error.sessionBudgetUsd - error.sessionSpentUsd).toFixed(2)} of $${error.sessionBudgetUsd.toFixed(2)} left`)
    if (error.dailyBudgetUsd !== undefined) left.push(`the last 24 hours have $${Math.max(0, error.dailyBudgetUsd - error.dailySpentUsd).toFixed(2)} of $${error.dailyBudgetUsd.toFixed(2)} left`)
    return {
      code: "X_BUDGET_EXCEEDED",
      what: `this call is estimated at $${error.estimateUsd.toFixed(2)}; ${left.join(" and ")}`,
      next: `Raise or remove "scriptBudgetUsd" or "scriptDailyBudgetUsd" in this plugin's options (both are opt-in), or wait for the 24-hour window to roll; each call is billed.`,
    }
  }
  if (error instanceof Error) {
    // The events_list and probe methods' own failures are xErrors: a code, what happened and the next step.
    const { code, detail, nextStep } = error as Error & { code?: unknown; detail?: unknown; nextStep?: unknown }
    if (typeof code === "string" && typeof detail === "string" && typeof nextStep === "string") return { code, what: detail, next: nextStep }
  }
  return undefined
}

/** X's plugin value for the tools RPC. Its shapers price each call; `plugin.ts` passes the `ownsXApp` option to them. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
