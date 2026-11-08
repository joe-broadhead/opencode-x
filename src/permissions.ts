import type { Plugin } from "@opencode/plugin"
import { errorText, SERVER_NAME } from "./constants.js"
import { EVENTS_LIST } from "./host/events-list.js"
import { reasonOf } from "./redact.js"
import { DENY_PATTERNS, DENY_TOOLS, READ_TOOLS } from "./x-tools.js"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "ask" | "deny"
}

/** The host's permission action for an MCP tool of the `x` server. */
const actionOf = (tool: string) => `${SERVER_NAME}_${tool}`
const rule = (tool: string, effect: Rule["effect"]): Rule => ({ action: actionOf(tool), resource: "*", effect })

/**
 * Broad first, narrow last, because the last matching rule wins: every X tool asks, including tools X adds later, then
 * the known reads run, and the plugin's own `x_events_list` for Memory's collector, then the tools the owner ruled out
 * are off. `DENY_TOOLS` names the 40 live tools that are off; `DENY_PATTERNS` holds
 * the effect-based deny that catches a future DM, follow, block, mute, post-delete, list-membership or account tool
 * before any release classifies it.
 */
export const defaultRules = (): Rule[] => [
  rule("*", "ask"),
  ...[...READ_TOOLS, EVENTS_LIST].map((tool) => rule(tool, "allow")),
  ...DENY_TOOLS.map((tool) => rule(tool, "deny")),
  ...DENY_PATTERNS.map((pattern) => rule(pattern, "deny")),
]

const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

/**
 * True when the default rules appear as one contiguous block anywhere after the agent's first base allow, inserted by
 * the plugin or pasted by the user. Other plugins insert their blocks at the same place, so the block need not come
 * first. False without a base allow.
 */
export function hasDefaultRules(permissions: readonly Rule[]) {
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  const rules = defaultRules()
  return permissions.some((_, start) => start > base && rules.every((item, offset) => permissions[start + offset] !== undefined && same(permissions[start + offset]!, item)))
}

/**
 * Splices `rules` in right after the agent's base `* * allow`, by index. Everything later still wins: the agent's
 * own stricter rules (Plan, Explore), the user's `permissions`, and saved approvals. Agents without a base allow,
 * or that already carry the rules, are left alone: there the block's ask would loosen a default deny. Returns whether
 * it inserted.
 */
export function insertRules(permissions: Rule[], rules: readonly Rule[]) {
  if (hasDefaultRules(permissions)) return false
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  permissions.splice(base + 1, 0, ...rules.map((item) => ({ ...item })))
  return true
}

/** Registers the default rules for every agent. Synchronous and never throws; a failure is kept for status. */
export function registerDefaultRules(
  agent: Pick<Plugin.Context["agent"], "transform">,
  rules: readonly Rule[],
  report: (problem: string | undefined) => void,
) {
  return agent.transform((editor) => {
    try {
      for (const { id } of editor.list()) editor.update(id, (info) => void insertRules(info.permissions, rules))
      report(undefined)
    } catch (error) {
      report(errorText("RULES_NOT_ADDED", `X's default permission rules could not be added (${reasonOf(error)}), so X tools may run without asking.`, "Restart OpenCode."))
    }
  })
}

const wildcard = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)

/** The host's evaluation for an MCP call (resource `*`): the last matching rule wins, and no match asks. */
export function evaluate(permissions: readonly Rule[], action: string): Rule["effect"] {
  return permissions.findLast((item) => wildcard(item.action).test(action) && wildcard(item.resource).test("*"))?.effect ?? "ask"
}

/**
 * Agents where a new X tool would run without asking: a base allow, no default rules after it, and nothing else in
 * the agent's own rules that asks or denies for it. An agent whose rules already stop every X tool needs no fix, and
 * one without a base allow gets no rules.
 */
export const unguardedAgents = (agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]) =>
  agents
    .filter((agent) => agent.permissions.some((item) => same(item, BASE_ALLOW)) && !hasDefaultRules(agent.permissions) && evaluate(agent.permissions, actionOf("new_tool")) === "allow")
    .map((agent) => agent.id)
