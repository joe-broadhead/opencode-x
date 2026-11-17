# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **X** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. The mark is X's own logo, as x.com draws it. Jelly's declaration contracts drop
a top-level key they don't know, and refuse an unknown key inside a tool, sign-in or `contributes`
entry, so the section uses only the keys Jelly reads.

`jelly.cost` is the line Jelly shows on the plugin's review before it installs, in the plugin's own words, saying what
it costs with X: "X bills every call to the X developer account that owns the app: about $0.005 a post read, $0.01 a
user read (each post or user once per UTC day), $0.015 a post created ($0.20 with a link). X sets the prices and can
change them." It changes nothing Jelly allows.

The line says what every call costs and claims nothing about a tool's answer. On the model path an answer carries a
cost line only for `x_search_posts_all`, `x_get_posts_by_id`, `x_get_posts_by_ids`, `x_get_posts_counts_recent`,
`x_get_users_mentions`, `x_get_users_timeline`, `x_get_users_posts`, `x_get_users_bookmarks`,
`x_get_users_bookmarks_by_folder_id`, `x_get_users_liked_posts`, `x_search_users`, `x_get_users_by_id`,
`x_get_users_by_username`, `x_get_users_by_usernames`, `x_get_users_me_followers`, `x_get_users_me_following`,
`x_get_users_list_memberships` and `x_get_users_blocking`; every other read, and every write, ends without one. A
script's result carries a cost line on every method X prices.

## Icons and vendor

`jelly.icon` stays `assets/icon.svg`, and `opencode.icons` declares the same mark three ways, in
MCP's `Icon` shape: the clean SVG (`sizes: ["any"]`), a 128×128 PNG and a 256×256 PNG, each with
its `mimeType` and a relative `src` inside the package. `opencode.icons[0].src` equals
`jelly.icon`, so the two declarations cannot drift. `exports` exposes the three files as
`./icon.svg`, `./icon-128.png` and `./icon-256.png`, and all three ship in the tarball.

`opencode.vendor` is `{ "id": "x", "name": "X", "domain": "x.com", "mark": true }`. `mark: true` says the icon is
the vendor's own mark: the X logo x.com serves in its own 24×24 viewBox, its path unchanged and its default black fill
written out, centred on a white rounded holding tile so it stays visible on dark backgrounds. The README carries the trademark line.

## Tools and permissions

102 tools are declared (58 read-only), and every declared effect is `allow`: the 51 reads and the 6 DM and public-key
reads, the 9 private writes, the public `x_create_posts`, and the 34 other changes that were once off. `jelly.tools`
follows `src/x-tools.ts`, so each declared tool has the effect the plugin's own `access: all` block gives it, and a
person's own choice replaces it.

- Reads: 51 of the tools return data and run without asking: posts, profiles, timelines, mentions, bookmarks, lists,
  Spaces, Communities, news, trends, your own broadcast's chat and moderators, and the usage balance.
- The other 6 `readOnly` tools are X's DM conversation and public-key reads. They reach private messages, and they run
  like the rest. Opening one message request is not read-only: X marks the messages delivered and updates the unread badge.
- Changes: bookmarks, lists, an Article draft, a media upload (`x_media_upload`, which returns an id for a later Post
  or DM) and the public `x_create_posts`, plus X's DM, follow, block, mute, list-membership, moderator and live-video
  tools. All of them run without asking under the default, on the user's real
  X account; `x_create_posts` is **public**: anyone can read the Post, and it can reply or quote only when the user asks
  for that one.
- No like and no repost tool: X's MCP exposes neither.

A tool X adds later, a write included, is not declared, so in Jelly it is not asked about: it runs without asking,
even if it changes something, until a new version of this plugin declares it. Keep `jelly.tools` in step with
`src/x-tools.ts`; `test/unit/jelly.test.ts` checks the list against it, and each declared effect against the plugin's
own default rules.

`test/unit/live-tools.test.ts` checks the declaration against X's tool list as Code Mode's catalogue showed it on 14
November 2026, in `test/fixtures/live-tools.json` (`provenance.json` says how): every listed tool is declared, every
declared tool is listed or is the plugin's own `x_events_list` (`test/fixtures/tool-registry.json`), and every effect is
`allow`. That list has names and input parameters only: OpenCode's sign-in to X was refused that day, so there is no
live capture with X's `readOnlyHint`s, and each `readOnly` is the class in `src/x-tools.ts`, from X's own description
of the tool.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page
against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit equal to the copy every plugin
carries. The tools RPC is the source contract's, bundled; X's sources are declared beside `jelly`, in the top-level
`sources` key, which Jelly reads through the source contract.

Jelly's shared rules for every plugin of the family, word for word:

<!-- family-block:start -->
- At Allowed (`all`), the default, every tool runs without asking, declared or not, whatever its `effect`.
- At Ask before changes (`ask-changes`), a `readOnly` tool runs, and every other tool asks first, including a tool this plugin does not declare.
- At Read only (`read-only`), a `readOnly` tool runs, and every other tool is off, including a tool this plugin does not declare.
- A declared `effect` of `allow` changes nothing: the tool follows the access choice and its `readOnly`.
- A declared `effect` of `ask` makes the tool ask at Ask before changes, even when it is `readOnly`, and changes nothing at Allowed or Read only.
- A declared `effect` of `deny` turns the tool off at Ask before changes and at Read only, and changes nothing at Allowed.
- An action listed in `asks` asks first at Ask before changes and at Read only, and never at Allowed.
- A tool named with one `*`, such as another account's `plaud-*.get_file`, follows the same rules as a tool named in full.
- A choice the person makes for one tool wins over the access choice and the declared `effect`.
- jelly leaves out a key it does not know at the top level of the `jelly` block, and reads the rest.
- jelly refuses the plugin for a key it does not know inside anything it reads, such as a tool, a sign-in or a setting.
- jelly refuses the plugin, with one plain line, when `requires` names a field or a feature it does not read.
<!-- family-block:end -->

## Skills

Declared: `x`, `x-write`. Jelly refuses an install whose skill ids collide with another plugin's or
the agent's own; they differ from the Slack plugin's `slack-search`, the Tavily plugin's `tavily`,
and the neighbours' meeting skills.

## Views

None: `jelly.views` and `jelly.rpc` are empty, and the plugin contributes no Home feed or widget.
A feed of posts would put other people's words on a dashboard and call billed tools unasked.

## Signing in

`jelly.signIns` declares the X app client ID, then `x`, for X's MCP server `x`, which signs in with OpenCode's MCP
OAuth. Its `scopes` are the scopes the plugin requests by default (`SCOPES` in `src/constants.ts`, sorted, as
Jelly requires); a deployment that sets its own `oauth.scopes` requests those instead. When the scopes X granted the active sign-in
lack one of them, as after an upgrade that adds `media.write`, the plugin marks that account as needing a new sign-in,
the same mark it sets when X stops accepting the token, and its status says "sign-in required" and names the scope. An X app supplies the client: an organisation can set a team app's public client ID in managed config, or the
user can save their own app in `/connect` → **X app**, before signing in.

Jelly folds the declared sign-in into this plugin's one card, which shows it as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of it. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Settings

Jelly draws a form from `jelly.contributes.settings` and writes each value into the plugin's options:

- `access` declares its three values as `choices`, with Jelly's own labels: **Allowed** (`all`, the default), **Ask
  before changes** (`ask-changes`) and **Read only** (`read-only`).
- `scriptBudgetUsd` (Script budget per session) and `scriptDailyBudgetUsd` (Script budget per 24 hours) are amounts in
  US dollars, in whole cents from $0.01. The options parser takes any amount above 0; Jelly's setting contract cannot
  say "above 0", so the declaration starts at one cent, which is narrower than the parser and never wider. Neither has a
  default: a budget left unsaved is no budget, and X's own billing and app spending limit apply.

Choices and bounds need a Jelly that includes app#1301: an older Jelly turns down a setting that declares them.
`test/unit/jelly.test.ts` checks the settings against Jelly's setting contract, restated in
`test/support/jelly-settings.ts`, and checks each declared value and bound against the options parser.

## Versions

Jelly's curated catalogue pins an exact version, so publish each release under a new version: a review in Jelly
can then tell the two apart.
