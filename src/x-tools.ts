// Every fact the plugin keeps about X's tools: their names, without the `x_` server prefix, sorted by what they do.
// The default rules, the tools RPC's methods, status's unknown and denied tools and the tests all derive from these
// lists; `jelly.tools` in package.json and the skills' tool names are checked against them. Keep this file free of
// runtime imports.
//
// The names come from X's MCP capability table, a third party's recorded tools/list (24 read and bookmark names) and
// X's own OpenAPI operation ids, which the hosted server names its tools after; provisional-tools.json in the design
// folder records the same table. X answers tools/list only for a signed-in token, so the table is provisional until a
// live list is recorded (CONTRIBUTING.md, "Drift check"). X may list fewer tools for a token with fewer scopes, so a
// known tool missing from a live list is normal and never reported.

/** Known reads: each only reads, by X's description, and sends nothing beyond its query. They run without asking. */
export const READ_TOOLS: readonly string[] = [
  "get_news",
  "get_posts_by_id",
  "get_posts_by_ids",
  "get_posts_counts_recent",
  "get_posts_liking_users",
  "get_posts_quoted_posts",
  "get_posts_reposted_by",
  "get_trends_by_woeid",
  "get_users_bookmark_folders",
  "get_users_bookmarks",
  "get_users_bookmarks_by_folder_id",
  "get_users_by_id",
  "get_users_by_username",
  "get_users_by_usernames",
  "get_users_me",
  "get_users_mentions",
  "get_users_posts",
  "get_users_timeline",
  "search_news",
  "search_posts_all",
  "search_users",
]

/**
 * Known writes: they ask before they run. Each changes only the user's own account, and the bookmark ones are
 * reversible and notify no one.
 */
export const WRITE_TOOLS: readonly string[] = ["article_create_draft", "create_users_bookmark", "create_users_bookmark_folder", "delete_users_bookmark"]

/**
 * Writes that reach other people: they ask, and the x-write skill says they are public. The catch-all ask already
 * covers them, so they add no rule of their own; Jelly and the skills read this list.
 */
export const PUBLIC_TOOLS: readonly string[] = ["article_publish"]

/**
 * Empty today: X's MCP exposes no DM, follow, block, mute, post-delete, list-change or account-setting tool. A tool
 * that appears later with one of those effects goes here, not in WRITE_TOOLS, and is off until the user turns it on.
 */
export const DENY_TOOLS: readonly string[] = []

/**
 * Name patterns for the tools the owner ruled out: a future tool that messages, follows or unfollows, blocks or mutes,
 * deletes a post, changes list membership or changes the account is denied even before a release classifies it. They
 * are the tool name without the server prefix, and deliberately narrow, so no known read matches one; the test checks
 * that. A user turns one on with a later `ask` rule in an agent's own permissions.
 */
export const DENY_PATTERNS: readonly string[] = [
  "create_dm*",
  "send_dm*",
  "delete_dm*",
  "get_dm*",
  "follow_*",
  "unfollow_*",
  "create_follow*",
  "delete_follow*",
  "block_*",
  "unblock_*",
  "mute_*",
  "unmute_*",
  "delete_post*",
  "delete_tweet*",
  "create_*list_member*",
  "delete_*list_member*",
  "add_*list_member*",
  "remove_*list_member*",
  "update_account*",
  "update_profile*",
  "delete_account*",
]

/** The host's wildcard: `*` matches any text, `?` one character. */
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)

/** True when the owner's ruling denies this tool by its effect, before any release classifies it. */
export const deniedByDefault = (name: string) => DENY_TOOLS.includes(name) || DENY_PATTERNS.some((pattern) => wildcard(pattern).test(name))

/**
 * Each known tool's input parameters, as `name:type`, with `*` after a required name. Empty until a tool list from a
 * signed-in server is recorded: X publishes no MCP schemas, and its 401 is a bare bearer challenge. The drift script
 * compares a saved tool list with this record and lists every tool still to record; the skills test lets a skill write
 * a literal call only with parameters recorded here, so until then the skills name tools without their inputs.
 */
export const PARAMETERS: Readonly<Record<string, readonly string[]>> = {}

export type ToolClass = "read" | "write" | "public" | "denied" | "unknown"

export function classify(name: string): ToolClass {
  if (READ_TOOLS.includes(name)) return "read"
  if (WRITE_TOOLS.includes(name)) return "write"
  if (PUBLIC_TOOLS.includes(name)) return "public"
  if (deniedByDefault(name)) return "denied"
  return "unknown"
}
