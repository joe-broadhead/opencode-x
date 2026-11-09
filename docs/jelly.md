# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **X** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. The mark is the family's **Neutral slate** tile — a spine with three nodes
and three rules, drawn by us — and not X's logo or letterform. Jelly's declaration contracts drop
a top-level key they don't know, and refuse an unknown key inside a tool, sign-in or `contributes`
entry, so the section uses only the keys Jelly reads.

## Icons and vendor

`jelly.icon` stays `assets/icon.svg`, and `opencode.icons` declares the same mark three ways, in
MCP's `Icon` shape: the clean SVG (`sizes: ["any"]`), a 128×128 PNG and a 256×256 PNG, each with
its `mimeType` and a relative `src` inside the package. `opencode.icons[0].src` equals
`jelly.icon`, so the two declarations cannot drift. `exports` exposes the three files as
`./icon.svg`, `./icon-128.png` and `./icon-256.png`, and all three ship in the tarball.

`opencode.vendor` is `{ "id": "x", "name": "X", "domain": "x.com" }`. A display app that has
decided to show X's official logo reads the domain and fetches it from X's own site, under X's
terms; the official mark never passes through this package, its tarball or a CDN. The package
carries no vendor marks, colours or letterforms: only our own Neutral slate tile.

## Tools and permissions

100 tools are declared (57 read-only), and every declared effect is `allow`: the 51 reads and the 6 DM and public-key
reads, the 8 private writes, the public `x_create_posts`, and the 34 other changes that were once off. `jelly.tools`
follows `src/x-tools.ts`, so each declared tool has the effect the plugin's own `access: all` block gives it. Jelly's
agents have no base "allow everything" rule, so this plugin's own default rules, which it puts after that rule, never
reach them; the declaration is what Jelly applies instead. A declared `allow` changes nothing in Jelly, and a person's
own choice replaces it.

- Reads: 51 of the tools return data and run without asking: posts, profiles, timelines, mentions, bookmarks, lists,
  Spaces, Communities, news, trends, your own broadcast's chat and moderators, and the usage balance.
- The other 6 `readOnly` tools are X's DM conversation and public-key reads. They reach private messages, and they run
  like the rest. Opening one message request is not read-only: X marks the messages delivered and updates the unread badge.
- Changes: bookmarks, lists, an Article draft and the public `x_create_posts`, plus X's DM, follow, block, mute,
  list-membership, moderator and live-video tools. All of them run without asking under the default, on the user's real
  X account; `x_create_posts` is **public**: anyone can read the Post, and it can reply or quote only when the user asks
  for that one.
- No like and no repost tool: X's MCP exposes neither.

A tool X adds later, a write included, is not declared, so in Jelly it is not asked about: it runs without asking,
even if it changes something, until a new version of this plugin declares it. Keep `jelly.tools` in step with
`src/x-tools.ts`; `test/unit/jelly.test.ts` checks the list against it, and each declared effect against the plugin's
own default rules.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page
against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit, and the shared part of the tools
RPC (`src/host/tools-rpc.ts`), equal to the copy every plugin carries.

## Skills

Declared: `x`, `x-write`. Jelly refuses an install whose skill ids collide with another plugin's or
the agent's own; they differ from the Slack plugin's `slack-search`, the Tavily plugin's `tavily`,
and the neighbours' meeting skills.

## Views

None: `jelly.views` and `jelly.rpc` are empty, and the plugin contributes no Home feed or widget.
A feed of posts would put other people's words on a dashboard and call billed tools unasked.

## Signing in

`jelly.signIns` declares the X app client ID, then `x`, for X's MCP server `x`, which signs in with OpenCode's MCP
OAuth. An X app supplies the client: an organisation can set a team app's public client ID in managed config, or the
user can save their own app in `/connect` → **X app**, before signing in.

Jelly folds the declared sign-in into this plugin's one card, which shows it as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of it. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version, so publish each release under a new version: a review in Jelly
can then tell the two apart.
