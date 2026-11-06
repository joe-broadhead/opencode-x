// The tool lists in src/x-tools.ts are the one record of X's tools; everything else derives from them.
import { describe, expect, test } from "bun:test"
import { classify, DENY_PATTERNS, DENY_TOOLS, deniedByDefault, PARAMETERS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"

const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS]

describe("X's tool lists", () => {
  test("name each tool once, in one list only, as a plain lower-case name without the server prefix", () => {
    expect(new Set(ALL).size).toBe(ALL.length)
    for (const name of ALL) expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    expect(ALL.filter((name) => name.startsWith("x_"))).toEqual([])
    for (const list of [READ_TOOLS, WRITE_TOOLS, PUBLIC_TOOLS]) expect([...list]).toEqual([...list].sort())
  })

  test("classify each tool by its list, and everything else as unknown", () => {
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
    for (const tool of PUBLIC_TOOLS) expect(classify(tool)).toBe("public")
    for (const tool of DENY_TOOLS) expect(classify(tool)).toBe("denied")
    for (const tool of ["shiny_new_tool", "", "x_search_posts_all", "SEARCH_POSTS_ALL", "describe"]) expect(classify(tool)).toBe("unknown")
  })

  test("counts 21 reads, 4 private writes, 1 public write and no denied tool, as the provisional table does", () => {
    expect(READ_TOOLS).toHaveLength(21)
    expect(WRITE_TOOLS).toHaveLength(4)
    expect(PUBLIC_TOOLS).toEqual(["article_publish"])
    expect(DENY_TOOLS).toEqual([])
    expect(ALL).toHaveLength(26)
  })

  test("reads never change anything: no create, add, change, delete or publish verb is a read", () => {
    const change = /^(create|add|change|consider|submit|send|update|move|archive|delete|set|publish)_/
    expect(READ_TOOLS.filter((tool) => change.test(tool))).toEqual([])
    expect(READ_TOOLS.every((tool) => /^(get|search)_/.test(tool))).toBe(true)
  })

  test("the only public write is publishing an Article; it is not a private write", () => {
    expect(WRITE_TOOLS).toContain("article_create_draft")
    expect(WRITE_TOOLS).not.toContain("article_publish")
    expect(PUBLIC_TOOLS).toEqual(["article_publish"])
  })

  test("no tool sends a DM, follows, blocks, mutes, deletes a post, changes list membership or account settings", () => {
    const deniedByRule = /^(create_dm|send_dm|follow|unfollow|block|mute|delete_post|delete_tweet|add_list|remove_list|update_account|update_profile)/
    expect(ALL.filter((tool) => deniedByRule.test(tool))).toEqual([])
  })

  test("the owner's ruling denies a future DM, follow, block, mute, delete, list or account tool by its effect", () => {
    for (const name of ["create_dm", "send_dm", "get_dm_events", "follow_user", "unfollow_user", "block_user", "mute_user", "delete_post", "delete_tweet", "create_list_member", "remove_list_members", "update_account", "update_profile", "delete_account"]) {
      expect({ name, denied: deniedByDefault(name), class: classify(name) }).toEqual({ name, denied: true, class: "denied" })
    }
    // The patterns are narrow: no known read, write or public tool is caught by one.
    for (const name of ALL) expect({ name, denied: deniedByDefault(name) }).toEqual({ name, denied: false })
    // A tool outside those effects still asks, through the catch-all.
    expect(deniedByDefault("schedule_post")).toBe(false)
    expect(deniedByDefault("shiny_new_tool")).toBe(false)
    expect(DENY_PATTERNS.length).toBeGreaterThan(10)
  })

  test("PARAMETERS stays empty until a live tool list is recorded", () => {
    expect(PARAMETERS).toEqual({})
  })
})
