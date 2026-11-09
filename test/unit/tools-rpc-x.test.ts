import { describe, expect, test } from "bun:test"
import { PLUGIN_ID } from "../../src/constants.js"
import { METHODS, NEXT_STEPS, PLUGIN_ID as RPC_PLUGIN_ID, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { DENY_TOOLS, PRIVATE_READ_TOOLS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"

describe("X's block of the shared tools RPC", () => {
  test("has the plugin's id and one method per known tool, by its exact name and class, and nothing else", () => {
    expect(RPC_PLUGIN_ID).toBe(PLUGIN_ID)
    expect(PLUGIN_ID).toBe("x.posts")
    expect(TOOLS_RPC_ID).toBe("x.posts.tools")
    expect(METHODS.map((method) => method.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS].sort())
    for (const name of READ_TOOLS) expect(METHODS.find((method) => method.name === name)?.class).toBe("read")
    for (const name of WRITE_TOOLS) expect(METHODS.find((method) => method.name === name)?.class).toBe("write")
    for (const name of PUBLIC_TOOLS) expect(METHODS.find((method) => method.name === name)?.class).toBe("send")
    for (const name of DENY_TOOLS) expect(METHODS.find((method) => method.name === name)?.class).toBe(PRIVATE_READ_TOOLS.includes(name) ? "read" : "destructive")
    expect(METHODS.find((method) => method.name === "get_chat_message_request")?.class).toBe("destructive")
    expect(METHODS.map((method) => method.name)).not.toContain("shiny_new_tool")
  })

  test("names /x-status and X's own cost and rate limits in its next steps", () => {
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toBe("Call describe to see which methods OpenCode lists now, and run /x-status.")
    expect(NEXT_STEPS.UPSTREAM_ERROR).toContain("if X reports a rate limit, wait for the reset it returns, and make fewer calls.")
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect")
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("opencode mcp auth x")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.x")
    expect(NEXT_STEPS.SESSION_UNKNOWN).toContain("x-opencode-directory")
    for (const next of Object.values(NEXT_STEPS)) expect(next.endsWith(".")).toBe(true)
  })
})
