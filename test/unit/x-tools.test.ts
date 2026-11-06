// The live list captured from a signed-in OpenCode on 2026-11-06 is the one record of X's tools; everything else
// derives from it. These tests pin every one of the 100 to its list and its intended default rule.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { classify, DENY_TOOLS, deniedByDefault, PARAMETERS, PUBLIC_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/x-tools.js"
import { defaultRules, evaluate, type Rule } from "../../src/permissions.js"

const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...PUBLIC_TOOLS, ...DENY_TOOLS]
const LIVE = (JSON.parse(readFileSync(new URL("./x-live-tools.json", import.meta.url), "utf8")) as { tools: { name: string }[] }).tools.map((tool) => tool.name)
const base: Rule = { action: "*", resource: "*", effect: "allow" }
const effectOf = (name: string) => evaluate([base, ...defaultRules()], `x_${name}`)

describe("X's live tool lists", () => {
  test("account for exactly the 100 tools in the captured list, each once and without the server prefix", () => {
    expect(ALL).toHaveLength(100)
    expect(new Set(ALL).size).toBe(ALL.length)
    expect([...ALL].sort()).toEqual([...LIVE].sort())
    for (const name of ALL) expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    expect(ALL.filter((name) => name.startsWith("x_"))).toEqual([])
  })

  test("count 51 reads that run, 8 private writes, 1 public write and 40 off", () => {
    expect(READ_TOOLS).toHaveLength(51)
    expect(READ_TOOLS).toEqual(expect.arrayContaining(["get_source", "list_sources"]))
    expect(WRITE_TOOLS).toHaveLength(8)
    expect(PUBLIC_TOOLS).toEqual(["create_posts"])
    expect(DENY_TOOLS).toHaveLength(40)
  })

  test("classify each tool by its list, and everything else as unknown", () => {
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
    for (const tool of PUBLIC_TOOLS) expect(classify(tool)).toBe("public")
    for (const tool of DENY_TOOLS) expect(classify(tool)).toBe("denied")
    for (const tool of ["shiny_new_tool", "", "x_search_posts_all", "SEARCH_POSTS_ALL", "describe", "article_publish"]) expect(classify(tool)).toBe("unknown")
  })

  test("every tool gets its intended default rule", () => {
    for (const tool of READ_TOOLS) expect({ tool, effect: effectOf(tool) }).toEqual({ tool, effect: "allow" })
    for (const tool of [...WRITE_TOOLS, ...PUBLIC_TOOLS]) expect({ tool, effect: effectOf(tool) }).toEqual({ tool, effect: "ask" })
    for (const tool of DENY_TOOLS) expect({ tool, effect: effectOf(tool) }).toEqual({ tool, effect: "deny" })
  })

  test("reads only read: get_ or search_, and no change verb", () => {
    const change = /^(create|add|change|update|delete|set|publish|send|schedule|archive|pin|unpin|follow|unfollow|block|mute)_/
    expect(READ_TOOLS.filter((tool) => change.test(tool))).toEqual([])
    expect(READ_TOOLS.every((tool) => /^(get|search|list)_/.test(tool))).toEqual(true)
  })

  test("posting is the one public write, and it is not a private write or a read", () => {
    expect(PUBLIC_TOOLS).toEqual(["create_posts"])
    expect(WRITE_TOOLS).not.toContain("create_posts")
    expect(READ_TOOLS).not.toContain("create_posts")
    // There is no publish tool for Articles: the draft is private, and publishing happens in the X app.
    expect(ALL).not.toContain("article_publish")
    expect(WRITE_TOOLS).toContain("article_create_draft")
  })

  test("the off list holds the DMs and private chat, follows, blocks, mutes, list membership, moderators, calls and live video", () => {
    for (const name of [
      "send_chat_message",
      "send_chat_typing_indicator",
      "accept_chat_message_request",
      "archive_chat_conversation",
      "unarchive_chat_conversation",
      "mark_chat_conversation_read",
      "mark_chat_conversation_unread",
      "get_chat_conversation",
      "get_chat_conversation_events",
      "get_chat_conversations",
      "get_chat_message_request",
      "get_chat_message_requests",
      "add_conversation_keys",
      "get_users_public_key",
      "get_users_public_keys",
      "chat_media_download",
      "chat_media_upload_append",
      "chat_media_upload_finalize",
      "chat_media_upload_initialize",
      "follow_list",
      "unfollow_list",
      "users_id_block",
      "users_id_unblock",
      "mute_broadcast_chat_user",
      "unmute_broadcast_chat_user",
      "add_lists_member",
      "remove_lists_member_by_user_id",
      "add_chat_moderator",
      "remove_chat_moderator",
      "schedule_call",
      "update_scheduled_call",
      "cancel_scheduled_call",
      "respond_to_scheduled_call",
      "create_scheduled_broadcast",
      "update_scheduled_broadcast",
      "delete_scheduled_broadcast",
      "go_live_scheduled_broadcast",
      "create_source",
      "update_source",
      "delete_source",
    ]) {
      expect({ name, denied: DENY_TOOLS.includes(name) }).toEqual({ name, denied: true })
    }
  })

  test("the safety patterns catch a later tool of a denied effect, and no known tool", () => {
    for (const name of ["create_dm", "send_chat_message_reaction", "get_chat_conversation_by_id", "follow_user", "block_user", "mute_user", "delete_post", "add_lists_member_to_list", "update_account", "users_id_follow", "users_id_mute", "create_chat_conversation", "update_chat_conversation", "delete_chat_conversation"]) {
      expect({ name, denied: deniedByDefault(name) }).toEqual({ name, denied: true })
    }
    for (const name of ALL) expect({ name, denied: deniedByDefault(name) }).toEqual({ name, denied: DENY_TOOLS.includes(name) })
    expect(deniedByDefault("schedule_post")).toBe(false)
    expect(deniedByDefault("shiny_new_tool")).toBe(false)
  })

  test("PARAMETERS records every live tool's inputs from its schema", () => {
    expect(Object.keys(PARAMETERS).sort()).toEqual([...LIVE].sort())
    for (const [tool, entries] of Object.entries(PARAMETERS)) {
      expect({ tool, hasEntries: Array.isArray(entries) }).toEqual({ tool, hasEntries: true })
      for (const entry of entries) expect(entry).toMatch(/^[a-z][a-zA-Z0-9_.]*\*?:[a-z<>|]+$/)
    }
    expect(PARAMETERS.create_posts).toEqual(expect.arrayContaining(["text:string", "reply:object", "quote_tweet_id:string", "edit_options:object"]))
    expect(PARAMETERS.search_posts_all).toEqual(expect.arrayContaining(["query*:string", "start_time:string", "end_time:string", "max_results:integer"]))
  })
})
