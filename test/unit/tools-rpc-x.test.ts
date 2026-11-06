import { describe, expect, test } from "bun:test"
import { PLUGIN_ID } from "../../src/constants.js"
import { KNOWN_READS, NEXT_STEPS, PLUGIN_ID as RPC_PLUGIN_ID, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { DENY_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"

describe("X's block of the shared tools RPC", () => {
  test("has the plugin's id and one method per known read, and nothing else", () => {
    expect(RPC_PLUGIN_ID).toBe(PLUGIN_ID)
    expect(PLUGIN_ID).toBe("x.posts")
    expect(TOOLS_RPC_ID).toBe("x.posts.tools")
    expect(KNOWN_READS).toEqual([...READ_TOOLS])
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS, "shiny_new_tool"]) expect(KNOWN_READS).not.toContain(tool)
  })

  test("names /x-status and X's own cost and rate limits in its next steps", () => {
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toBe("Call describe to see which methods OpenCode lists now, and run /x-status.")
    expect(NEXT_STEPS.UPSTREAM_ERROR).toContain("if X reports a rate limit, wait for the reset it returns, and make fewer calls.")
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect")
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("opencode mcp auth x")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.x")
    for (const next of Object.values(NEXT_STEPS)) expect(next.endsWith(".")).toBe(true)
  })
})
