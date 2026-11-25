// The X plugin's server entry: one `register` call wires every door (contract §9).
//
// `assertHost` refuses an untested OpenCode release before anything is registered. The accounts module registers one
// vendor MCP server per alias; the provider runs X's own tools through the host's executors, so the plugin holds no
// token; the handler table carries the plugin's three own methods. The manifest's `events` is empty, so the register
// builds no bus event to emit: the plugin makes no write of its own.
import { Plugin } from "@opencode/plugin"
import { accountsOf, registerAccounts } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { createObservations, maxCallsOf, optionsError, serverConfig } from "./accounts.js"
import { createHandlers } from "./handlers/index.js"
import { manifest, VERSION } from "./manifest.js"
import { createProvider, serverStates } from "./provider/index.js"
import { loadSkills, registerSkills } from "./skills.js"

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(ctx) {
    assertHost(ctx, manifest)
    const options = (ctx.options ?? {}) as Record<string, unknown>
    const plan = accountsOf(manifest, options)
    if (!plan.ok) throw optionsError(plan.problems)
    const loaded = await loadSkills()
    await registerSkills(ctx.skill, loaded.skills)
    const maxCalls = maxCallsOf(manifest, options)
    const observations = createObservations()
    const accounts = await registerAccounts(ctx, {
      manifest,
      options,
      server: (account) => serverConfig(account),
    })
    const provider = createProvider({
      tools: ctx.tool,
      servers: async () => serverStates(await ctx.mcp.list()),
    })
    const handlers = createHandlers({
      manifest,
      version: VERSION,
      hostVersion: ctx.app.version,
      profiles: plan.value.accounts,
      provider,
      observations,
      maxCalls,
      now: () => Date.now(),
      problems: () => [...loaded.problems, ...accounts.problems],
    })
    const registration = await register(ctx, manifest, handlers)
    return () => registration.dispose()
  },
})
