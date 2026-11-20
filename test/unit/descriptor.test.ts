// Jelly pins source-contract v0.1.0, and its validator refuses the whole `sources` declaration for one key it does not
// know. The descriptor therefore carries only v0.1.0's keys, exactly: this test walks package.json's `sources` and fails
// on any key v0.2.0 or v0.3.0 added (`readsIdentity`, `identityRules`, `facts`, `hints`, `routines`, ...).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { sources: Record<string, any> }

/**
 * source-contract v0.1.0's `dist/schemas/sources.json`, as its key sets. Every object it describes is closed
 * (`additionalProperties: false`), so this list is the whole vocabulary Jelly's validator accepts.
 */
const KEYS = {
  sources: ["contractVersion", "items", "probe", "rpc"],
  probe: ["action"],
  item: ["accounts", "cadence", "cost", "details", "id", "input", "kind", "maxAgeSec", "maxBytes", "output", "outputSchema", "params", "permission", "private", "reads", "retentionDays", "scope", "tool", "urlHosts"],
  accounts: ["named"],
  permission: ["events", "identity", "operations", "rules", "tool"],
  scope: ["describe", "keys", "suggest"],
  cost: ["class", "units", "probe"],
  price: ["per", "usd"],
  rule: ["action", "resource"],
} as const

/** Keys of `value` that `allowed` does not hold, as `path.key`; a non-object is nothing to check. */
function unknownKeys(value: unknown, allowed: readonly string[], path: string, problems: string[]): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  for (const key of Object.keys(value)) if (!allowed.includes(key)) problems.push(`${path}.${key}`)
}

/** Every key v0.1.0 would refuse in a declaration like package.json's `sources`. */
function v02OrLaterKeys(sources: Record<string, any>): string[] {
  const problems: string[] = []
  unknownKeys(sources, KEYS.sources, "sources", problems)
  unknownKeys(sources["probe"], KEYS.probe, "sources.probe", problems)
  for (const [index, item] of ((sources["items"] as Record<string, any>[]) ?? []).entries()) {
    const at = `sources.items[${index}]`
    unknownKeys(item, KEYS.item, at, problems)
    unknownKeys(item["accounts"], KEYS.accounts, `${at}.accounts`, problems)
    unknownKeys(item["permission"], KEYS.permission, `${at}.permission`, problems)
    unknownKeys(item["scope"], KEYS.scope, `${at}.scope`, problems)
    unknownKeys(item["cost"], KEYS.cost, `${at}.cost`, problems)
    for (const unit of ((item["cost"]?.["units"] as unknown[]) ?? [])) unknownKeys(unit, KEYS.price, `${at}.cost.units[]`, problems)
    if (item["cost"]?.["probe"] !== undefined) unknownKeys(item["cost"]["probe"], KEYS.price, `${at}.cost.probe`, problems)
    for (const rule of ((item["permission"]?.["rules"] as unknown[]) ?? [])) unknownKeys(rule, KEYS.rule, `${at}.permission.rules[]`, problems)
  }
  return problems
}

describe("package.json's sources", () => {
  test("carry only source-contract v0.1.0's keys, which Jelly's validator accepts", () => {
    expect(v02OrLaterKeys(pkg.sources)).toEqual([])
    // The released sources keep the identity read the lists share, as a v0.1 key.
    expect(pkg.sources["items"].every((item: Record<string, any>) => !("readsIdentity" in item["permission"]))).toBe(true)
  })

  test("the check catches a v0.2 or v0.3 key, so a future edit fails here rather than in Jelly", () => {
    const withIdentity = structuredClone(pkg.sources)
    withIdentity["items"][0]["permission"]["readsIdentity"] = true
    expect(v02OrLaterKeys(withIdentity)).toEqual(["sources.items[0].permission.readsIdentity"])
    const withFacts = structuredClone(pkg.sources)
    withFacts["items"][0]["facts"] = []
    expect(v02OrLaterKeys(withFacts)).toEqual(["sources.items[0].facts"])
    const withHints = structuredClone(pkg.sources)
    withHints["hints"] = "src/hints.ts"
    expect(v02OrLaterKeys(withHints)).toEqual(["sources.hints"])
  })
})
