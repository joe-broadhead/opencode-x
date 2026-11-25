// The package and its manifest: the shape the standard names, and the methods inventory's classes.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { manifest } from "../../src/manifest.js"
import { FEEDS } from "../../src/provider/index.js"

interface PackageFile {
  readonly name: string
  readonly version: string
  readonly exports: Record<string, string>
  readonly files: string[]
  readonly devDependencies: Record<string, string>
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly scripts: Record<string, string>
  readonly capabilities: typeof manifest
}

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageFile

describe("the package", () => {
  test("is the standard's name, version, exports and files, with devDependencies only", () => {
    expect(pkg.name).toBe("@we-the-rebel-alliance/x-plugin")
    expect(pkg.version).toBe("0.0.0")
    expect(pkg.exports).toEqual({ "./server": "./dist/index.js" })
    expect(pkg.files).toEqual(["dist", "skills", "assets", "README.md", "LICENSE"])
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.peerDependencies).toBeUndefined()
    expect(pkg.devDependencies["@we-the-rebel-alliance/plugin-contract"]).toBe("github:we-the-rebel-alliance/plugin-contract#v0.0.0")
    expect(pkg.devDependencies["@opencode/plugin"]).toBe("2.4.1")
    expect(pkg.devDependencies["@opencode/sdk"]).toBe("2.4.1")
    expect(pkg.scripts.check).toContain("npx plugin-kit check")
  })

})

describe("the manifest", () => {
  test("is the standard's identity and host range", () => {
    expect(manifest.version).toBe(1)
    expect(manifest.plugin.name).toBe("x")
    expect(manifest.plugin.vendor).toEqual({ id: "x", name: "X", domain: "x.com" })
    expect(manifest.plugin.host).toEqual({ opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
    expect(manifest.plugin.icons.length).toBeGreaterThan(0)
    expect(manifest.plugin.summary.length).toBeLessThanOrEqual(400)
    expect(manifest.plugin.summary.split("\n")).toHaveLength(1)
  })

  test("accounts are one vendor MCP server per alias", () => {
    expect(manifest.accounts).toEqual({
      via: "mcp",
      profile: { $ref: "#/options/properties/accounts/additionalProperties" },
      owner: "x",
    })
    const accounts = manifest.options["properties"] as Record<string, Record<string, unknown>>
    expect(accounts["access"]).toMatchObject({ default: "all", enum: ["all", "ask-changes", "read-only"] })
    expect(accounts["allowUntestedHost"]).toMatchObject({ default: false })
  })

  test("every callable is classified: 3 own methods and 101 pass-through tools", () => {
    const counts: Record<string, number> = {}
    for (const item of Object.values(manifest.methods)) counts[item.class] = (counts[item.class] ?? 0) + 1
    expect(Object.keys(manifest.methods)).toHaveLength(104)
    expect(counts).toEqual({ read: 60, write: 20, send: 11, delete: 5, export: 1, admin: 7 })
    for (const own of ["status", "probe", "events_list"]) expect(manifest.methods[own]?.class).toBe("read")
    expect(manifest.methods["status"]?.accounts).toBe("none")
    expect(manifest.methods["probe"]?.accounts).toBe("optional")
    expect(manifest.methods["events_list"]?.accounts).toBe("optional")
    for (const [name, item] of Object.entries(manifest.methods)) {
      if (!name.startsWith("mcp:")) continue
      expect(item.accounts).toBe("optional")
      expect(item.operations).toEqual([name.slice("mcp:".length)])
    }
  })

  test("the inventory's harder classes are not flattened", () => {
    expect(manifest.methods["mcp:delete_users_bookmark"]?.class).toBe("delete")
    expect(manifest.methods["mcp:remove_lists_member_by_user_id"]?.class).toBe("delete")
    expect(manifest.methods["mcp:chat_media_download"]?.class).toBe("export")
    expect(manifest.methods["mcp:get_chat_message_request"]?.class).toBe("write")
    expect(manifest.methods["mcp:create_posts"]?.class).toBe("send")
    expect(manifest.methods["mcp:users_id_block"]?.class).toBe("admin")
    for (const name of ["mcp:get_chat_conversation", "mcp:get_chat_conversation_events", "mcp:get_chat_conversations", "mcp:get_chat_message_requests", "mcp:get_users_public_key", "mcp:get_users_public_keys"]) {
      expect(manifest.methods[name]).toMatchObject({ class: "read", effect: "ask" })
    }
  })

  test("three events sources on one billed service, and no action or bus event", () => {
    expect(manifest.sources.map((source) => source.id)).toEqual(["x.mentions", "x.bookmarks", "x.timeline"])
    expect(manifest.sources.map((source) => (source.kind === "events" ? source.reads : ""))).toEqual(["message", "bookmark", "message"])
    expect(manifest.sources.map((source) => source.private)).toEqual([false, true, false])
    for (const source of manifest.sources) {
      expect(source.method).toBe("events_list")
      expect(source.service).toEqual({ id: "x.feeds", label: "X" })
      expect(source.input).toEqual({ source: (source.input as { source: string }).source })
      expect(FEEDS).toContain((source.input as { source: string }).source as (typeof FEEDS)[number])
      expect(source.cost.class).toBe("billed")
      expect(source.cost.units).toEqual([
        { per: "post", usd: 0.005 },
        { per: "author", usd: 0.01 },
        { per: "user", usd: 0.01 },
      ])
      expect(source.maxBytes).toBe(900_000)
      expect(source.urlHosts).toEqual(["x.com"])
      expect(source.operations).toEqual(["get_users_me", { mentions: "get_users_mentions", bookmarks: "get_users_bookmarks", timeline: "get_users_timeline" }[(source.input as { source: "mentions" | "bookmarks" | "timeline" }).source]])
    }
    expect(manifest.methods["events_list"]?.operations).toBeUndefined()
    expect(manifest.actions).toEqual([])
    expect(manifest.events).toEqual({})
  })
})
