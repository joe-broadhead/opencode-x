import { describe, expect, test } from "bun:test"
import { PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS, DENY_TOOLS } from "../../src/x-tools.js"
import { defaultRules, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"
import { agentEditor, allow, builtInAgents, transforms, type AgentEditor, type FakeAgent } from "./fake.js"

const deny = (action: string): Rule => ({ action, resource: "*", effect: "deny" })
const ACTIONS = ["x_search_posts_all", "x_get_users_me", "x_create_users_bookmark", "x_create_posts", "x_get_source", "x_send_chat_message", "x_users_id_block", "x_shiny_new_tool"]
const effects = (rules: readonly Rule[]) => ACTIONS.map((action) => evaluate(rules, action))

describe("defaultRules", () => {
  test("access all allows the namespace pattern, so a tool added later works at once", () => {
    expect(defaultRules("all")).toEqual([{ action: "x_*", resource: "*", effect: "allow" }])
    expect(effects([allow("*"), ...defaultRules("all")])).toEqual(["allow", "allow", "allow", "allow", "allow", "allow", "allow", "allow"])
  })

  test("ask-changes allows the reads and asks for every other tool", () => {
    const rules = [allow("*"), ...defaultRules("ask-changes")]
    expect(rules[1]).toEqual({ action: "x_*", resource: "*", effect: "ask" })
    for (const tool of READ_TOOLS) expect({ tool, effect: evaluate(rules, `x_${tool}`) }).toEqual({ tool, effect: "allow" })
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS, "shiny_new_tool"]) expect({ tool, effect: evaluate(rules, `x_${tool}`) }).toEqual({ tool, effect: "ask" })
  })

  test("read-only allows the reads and denies every other tool", () => {
    const rules = [allow("*"), ...defaultRules("read-only")]
    for (const tool of READ_TOOLS) expect({ tool, effect: evaluate(rules, `x_${tool}`) }).toEqual({ tool, effect: "allow" })
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS, "shiny_new_tool"]) expect({ tool, effect: evaluate(rules, `x_${tool}`) }).toEqual({ tool, effect: "deny" })
  })

  test("a user's later rule still wins, both ways", () => {
    const rules = [allow("*"), ...defaultRules("ask-changes"), allow("x_create_posts"), deny("x_search_posts_all")]
    expect(evaluate(rules, "x_create_posts")).toBe("allow")
    expect(evaluate(rules, "x_search_posts_all")).toBe("deny")
  })
})

describe("insertRules", () => {
  test("splices the chosen block right after the base allow, before the agent's own rules", () => {
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      const rules = defaultRules(access)
      for (const agent of builtInAgents()) {
        const before = agent.permissions.slice()
        expect(insertRules(agent.permissions, rules)).toBe(true)
        expect(agent.permissions).toEqual([before[0]!, ...rules, ...before.slice(1)])
      }
    }
  })

  test("is idempotent, and finds the block after another plugin's", () => {
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      const rules = defaultRules(access)
      const permissions = [allow("*")]
      insertRules(permissions, rules)
      const once = permissions.slice()
      expect(insertRules(permissions, rules)).toBe(false)
      expect(permissions).toEqual(once)
      const later = [allow("*"), allow("github_*"), ...rules, allow("x_create_users_bookmark")]
      expect(insertRules(later, rules)).toBe(false)
    }
  })

  test("only the whole block counts, and an agent without a base allow is left alone", () => {
    const own = [allow("*"), { action: "x_*", resource: "*", effect: "ask" as const }]
    expect(hasDefaultRules(own, "ask-changes")).toBe(false)
    expect(insertRules(own, defaultRules("ask-changes"))).toBe(true)
    for (const permissions of [[], [deny("*")], [allow("read")]] as Rule[][]) expect(insertRules(permissions, defaultRules("all"))).toBe(false)
  })

  test("stricter agents stay stricter: Explore's own deny still wins", () => {
    const [, plan, explore] = builtInAgents() as [FakeAgent, FakeAgent, FakeAgent]
    insertRules(explore.permissions, defaultRules("all"))
    expect(effects(explore.permissions).every((effect) => effect === "deny")).toBe(true)
    insertRules(plan.permissions, defaultRules("all"))
    expect(effects(plan.permissions).every((effect) => effect === "allow")).toBe(true)
  })
})

describe("registerDefaultRules", () => {
  test("adds the chosen block to every agent once per rebuild and reports no problem", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules("ask-changes"), (problem) => problems.push(problem))
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const agents = builtInAgents()
      run(agentEditor(agents))
      for (const agent of agents) expect(hasDefaultRules(agent.permissions, "ask-changes")).toBe(true)
    }
    expect(problems).toEqual([undefined, undefined])
  })

  test("never throws; a failure is reported for status", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules("all"), (problem) => problems.push(problem))
    const broken = { ...agentEditor([]), list: () => { throw new Error("boom") } }
    expect(() => run(broken)).not.toThrow()
    expect(problems[0]).toStartWith("RULES_NOT_ADDED:")
  })
})

describe("unguardedAgents", () => {
  test("names agents with a base allow, no block, and rules that would let a new X tool run", () => {
    const agents = [
      { id: "build", permissions: [allow("*"), ...defaultRules("all")] },
      { id: "reviewer", permissions: [allow("*")] },
      { id: "fixed", permissions: [allow("*"), ...defaultRules("all"), allow("x_create_users_bookmark")] },
      { id: "other-plugin-first", permissions: [allow("*"), allow("github_*"), ...defaultRules("all")] },
      { id: "block-before-base", permissions: [...defaultRules("all"), allow("*")] },
      { id: "ask-rule-only", permissions: [allow("*"), { action: "x_*", resource: "*", effect: "ask" as const }] },
      { id: "locked", permissions: [allow("*"), deny("*")] },
      { id: "denies-x", permissions: [allow("*"), deny("x_*")] },
      { id: "own-allow-no-base", permissions: [allow("x_*")] },
    ]
    expect(unguardedAgents(agents)).toEqual(["reviewer", "block-before-base"])
    expect(hasDefaultRules([allow("*"), ...defaultRules("all")])).toBe(true)
    expect(hasDefaultRules(defaultRules("all"))).toBe(false)
  })
})
