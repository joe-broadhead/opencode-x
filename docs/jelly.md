# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **X** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. The mark is a neutral speech bubble with a search lens on a slate tile, not
X's logo. Jelly's declaration contracts drop a top-level key they don't know, and refuse an unknown
key inside a tool, sign-in or `contributes` entry, so the section uses only the keys Jelly reads.

## Tools and permissions

100 tools are declared: 49 reads run, 2 read-only source tools ask, 8 private writes and the public
`x_create_posts` ask, and 40 are off — every tool in `src/x-tools.ts`. Jelly's agents have no base "allow
everything" rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly writes
each declared `ask` or `deny` as that tool's default instead (the person's own choice replaces it), and denies a
read-only helper every tool not marked `readOnly`. A declared `allow` changes nothing in Jelly.

- Ask: `x_create_users_bookmark`, `x_delete_users_bookmark` and `x_create_users_bookmark_folder` (the user's
  bookmarks); `x_article_create_draft` (a private draft, with no publish tool here); `x_create_lists`,
  `x_update_lists`, `x_pin_list` and `x_unpin_list` (the user's lists; public unless `private` is true); and
  `x_get_source` and `x_list_sources` (their output can carry a stream key). `x_create_posts` is **public**: anyone
  can read the Post, and it can reply or quote only when the user asks for that one.
- Off: the 40 tools for DMs and chat (reads included), scheduled calls, follows, blocks, mutes, list membership, chat
  moderators, and live video with its sources.
- Everything else runs, as the plugin's own rules let it.

A tool X adds later, a write included, is not declared, so in Jelly it is not asked about: it runs without asking,
even if it changes something, until a new version of this plugin declares it. The plugin itself denies a future tool
of a denied effect, but Jelly does not, so set it to deny there. Keep `jelly.tools` in step with `src/x-tools.ts`;
`test/unit/jelly.test.ts` checks the list against it, and each declared effect against the plugin's own default rules.

## Skills

Declared: `x`, `x-write`. Jelly refuses an install whose skill ids collide with another plugin's or
the agent's own; they differ from the Slack plugin's `slack-search`, the Tavily plugin's `tavily`,
and the neighbours' meeting skills.

## Views

None: `jelly.views` and `jelly.rpc` are empty, and the plugin contributes no Home feed or widget.
A feed of posts would put other people's words on a dashboard and call billed tools unasked.

## Signing in

`jelly.signIns` declares one sign-in, `x`, for X's MCP server `x`, which signs in with OpenCode's MCP
OAuth. An X app supplies the client: an organisation can set a team app's public client ID in managed config, or the
user can save their own app in `/connect` → **X app**, before signing in.

Jelly folds the declared sign-in into this plugin's one card, which shows it as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of it. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version, so publish each release under a new version: a review in Jelly
can then tell the two apart.
