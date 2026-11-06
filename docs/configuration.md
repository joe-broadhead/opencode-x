# Configuration

Every option is optional. The smallest setup is one entry in `plugins`, then the X app in `/connect`:

```json
{
  "plugins": ["@joe-broadhead/opencode-x"]
}
```

To set options, use the object form:

```json
{
  "plugins": [
    {
      "package": "@joe-broadhead/opencode-x",
      "options": {
        "oauth": { "client_id": "YOUR_X_CLIENT_ID", "client_secret": "{env:X_CLIENT_SECRET}" }
      }
    }
  ]
}
```

## Options

### `oauth`

X has no dynamic client registration and no client metadata documents. The plugin signs in with **your own X app**,
so it needs the app's OAuth 2.0 client. The values go in the plugin options (managed config) or in the `/connect`
**X app** entry. Options win. From a terminal, `opencode auth login x-app` saves the client ID and secret, and
`opencode auth logout x-app` removes them.

| Key | Values | Default | Notes |
| --- | --- | --- | --- |
| `client_id` | A non-empty string without spaces | none | The app's **Client ID**. A public client ID is what a team app shares in managed config. Without it, status is `not configured`. |
| `client_secret` | A non-empty string, preferably `{env:X_CLIENT_SECRET}` | none | For a confidential (Web App) app. Leave it out for a Native App, a public client with PKCE and no secret; X issued it a refresh token in the live test. Needs `client_id`. |
| `redirect_uri` | An `http:` loopback URL with an explicit port and a path, or an `https:` URL | `http://127.0.0.1:8766/callback` | X matches it exactly. Register the same URL in the app's **User authentication settings**. |
| `callback_port` | `1`–`65535` | none | Only, and always, with an `https:` redirect: the local port a proxy forwards the callback to. With a loopback redirect, OpenCode listens on the redirect's own port. |
| `scopes` | A non-empty list of X OAuth 2.0 scopes | `tweet.read users.read follows.read like.read block.read list.read list.write space.read broadcast.read calls.read bookmark.read bookmark.write tweet.write offline.access` | `offline.access` is what makes X issue a refresh token. Dropping a group's scope makes those tools fail with `403`, or removes them from the list. |

The plugin never shows the client secret: status and the RPC name the client ID, whether a secret is set, and where it
came from. The secret lives in OpenCode's credential store, or in managed config.

### `{env:NAME}`

OpenCode substitutes `{env:NAME}` in a config value when it loads the file, so `"client_secret": "{env:X_CLIENT_SECRET}"`
keeps the secret in your environment, not in a file that may be synced, backed up or shared. An unset variable arrives
as an empty string, which `OPTIONS_INVALID` rejects. A variable exported in a terminal reaches only an OpenCode started
from that terminal; when OpenCode runs as a service or the desktop app, save the secret through `/connect` → **X app**
instead.

### `allowUntestedHost`

- Type: `true` or `false`.
- Default: `false`.

The plugin supports OpenCode `>=2.2.3 <2.3.0`, the range `opencode.host` in `package.json` declares, and every check
runs on 2.2.3, 2.2.4 and 2.2.5, the tested releases. Status shows the version, whether it is tested and the supported
range in its `OpenCode` row, for example `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`.

- **A tested release:** the plugin starts.
- **Another release inside the range, such as 2.2.6:** the plugin starts too. Status marks the version `untested`,
  and the status RPC's `host.tested` is `false`. The next step is the same as on a tested release.
- **Outside the range, including 2.3.0, prereleases and development builds:** the plugin does not set itself up, and
  `/x-status` shows `host untested` with the fix. `/plugins` shows the same code:

  ```text
  HOST_UNTESTED: OpenCode 2.3.0 is outside the supported range >=2.2.3 <2.3.0, so X is not set up. Next step: Use OpenCode >=2.2.3 <2.3.0, or set "allowUntestedHost": true in this plugin's options to run anyway.
  ```

- **Outside the range with `"allowUntestedHost": true`:** it starts anyway, and `/x-status` and `/x` show a warning.

To narrow what the model may do in X, use permission rules; see [Permissions](#permissions).

## Team app

One admin creates one **public** X app and shares its **client ID**. Members then only sign in: there is no X app step,
no secret, and no per-member app.

**The admin, once:**

1. In [console.x.com](https://console.x.com), create an app and open **User authentication settings**. Set OAuth 2.0
   on, choose **Native App** (a public client: client ID only, no secret), and register **both** callbacks:
   `http://127.0.0.1:8766/callback` and `http://localhost:8766/callback`.
2. Add the scopes `tweet.read users.read follows.read like.read block.read list.read list.write space.read broadcast.read calls.read bookmark.read bookmark.write tweet.write offline.access`.
3. Move the app to **Pay-per-use → Production**. Without it, X answers `client-not-enrolled`.
4. Buy **credits** and set a **spending limit**. Every member's calls draw on them.

**The members' config.** Put the client ID in the organisation's managed config, with no secret:
`/Library/Application Support/opencode/opencode.json` on macOS, or `/etc/opencode/opencode.json` on Linux.

```json
{
  "plugins": [
    {
      "package": "@joe-broadhead/opencode-x",
      "options": { "oauth": { "client_id": "YOUR_TEAM_APP_CLIENT_ID" } }
    }
  ]
}
```

Each member runs `/connect` and chooses X, then presses `o` or Enter. Status shows
`configured app, public; set in plugin options`, and the `X app` entry is not used.

**The consequences, plainly:**

- Every member's calls bill the team's X developer account. A model read is capped to one page of at most ten posts
  or users, one widening, about $0.20 an answer, and the answer ends with its actual cost line; a script is not capped,
  so the app's spending limit is the backstop.
- The owned-reads discount (about $0.001 a post) applies only when the authenticated user owns the app. Other members'
  timeline, mention and bookmark reads bill at the full rate.
- X describes pay-per-use as for "applications with limited end-users". A larger team may need X's Enterprise plan.
- Under X's Developer Agreement, the admin is responsible for how the app is used and for the content it reads.
- A public client ID is not a secret and is safe to distribute. **Never** put a client secret in managed config.
- X issued a public Native App a refresh token in the live test on 2026-11-06, and OpenCode refreshed it after about
  two hours. `offline.access` is still required.

## Your own `mcp.servers.x`

If your config defines no server named `x`, and the plugin has a client, it registers one:

```json
{
  "type": "remote",
  "url": "https://api.x.com/mcp",
  "oauth": {
    "client_id": "YOUR_X_CLIENT_ID",
    "client_secret": "{env:X_CLIENT_SECRET}",
    "redirect_uri": "http://127.0.0.1:8766/callback",
    "scope": "tweet.read users.read bookmark.read bookmark.write tweet.write offline.access"
  }
}
```

`protocol`, timeouts, headers and Code Mode keep OpenCode's defaults.

To change anything else, define `mcp.servers.x` yourself at X's URL. The plugin then **adopts** your entry unchanged,
and `/x-status` shows "Connection: connected (…, your own mcp.servers.x, used unchanged)". The permission rules and
skills still apply. Of your entry the plugin reads only its type, its URL and whether `oauth` is `false`; it never
reads, copies or reports its `headers` or its client secret.

An adopted entry is used exactly as written. If it has no `oauth.clientId`, OpenCode cannot register a client with X
and the sign-in fails; `/connect` keeps showing `sign-in required`, and status reports the connection state rather
than guessing about another entry's fields.

X's server signs in only with OAuth. An entry with `"oauth": false` cannot connect: status names it as "your own
mcp.servers.x without OAuth", and its next step is to remove that line. X's app-only bearer token cannot reach your
timeline, mentions or bookmarks, and the hosted MCP server takes a user sign-in.

### A conflict

The plugin compares origin and path, so a trailing slash or a query string still matches. Any other URL, or a local
command, is a **conflict**: the plugin leaves your entry alone, adds nothing, status shows "Connection: conflict",
and gives the next step:

```text
- Next step: Your OpenCode config defines mcp.servers.x with https://x-mcp.example.com/mcp, but the plugin uses https://api.x.com/mcp. Point it at https://api.x.com/mcp or remove it, then restart OpenCode.
```

## Permissions

OpenCode asserts every MCP call itself, with the action `x_<tool>` and the resource `*`. The plugin adds these rules
to every agent that starts with the base rule `{ "action": "*", "resource": "*", "effect": "allow" }`, directly
after that rule:

```json
[
  { "action": "x_*", "resource": "*", "effect": "ask" },
  { "action": "x_get_news", "resource": "*", "effect": "allow" },
  { "action": "x_search_posts_all", "resource": "*", "effect": "allow" }
]
```

That sample leaves out the other 47 read allows, which sit between the two shown; `/x-status` prints the whole block,
and its `Agents without default rules` row prints it as a list to paste.

`READ_TOOLS` in `src/x-tools.ts` lists the 51 reads that run; `WRITE_TOOLS` the 8 private writes; `PUBLIC_TOOLS`
the one public write, `create_posts`; `DENY_TOOLS` the 40 tools that are off; and `DENY_PATTERNS` a safety net for a
future tool of the same effect. A write or a tool X adds later that is not one of those effects matches only `x_*`,
so it asks. `/x-status` names the
tools in no list. X may list fewer tools for a token with fewer scopes, so a known tool can be missing; that is normal.

The private writes, which ask:

- `x_create_users_bookmark` bookmarks a post for the user only, and `x_delete_users_bookmark` removes that bookmark,
  not the post. `x_create_users_bookmark_folder` creates a folder only the user sees.
- `x_article_create_draft` saves a private Article draft. There is no publish tool: it stays a draft, and the user
  publishes it in X.
- `x_create_lists`, `x_update_lists`, `x_pin_list` and `x_unpin_list` change the user's lists. A list is public unless
  `private` is true.

`x_create_posts` is public: anyone can read the Post, and it appears on the user's profile and in followers'
timelines. It can reply (`reply.in_reply_to_tweet_id`), quote (`quote_tweet_id`) or edit
(`edit_options.previous_post_id`); each asks, only on an explicit request. `x_get_source` and `x_list_sources` run
like other reads; X's description says the stream key is not in that response, and no tool here exposes it.

A deny also hides the tool from the model. The 40 off tools are DMs and private chat conversations (reads included), follows, blocks,
mutes, list membership, chat moderators, scheduled calls, and live video with its sources. Turning one on takes a
later `ask` rule in an agent's own `permissions`; the recipes below narrow.

To narrow one agent, add a rule to that agent's own `permissions`, which come after the plugin's block in that agent.
For the build agent, turn posting off:

```json
{
  "agents": {
    "build": {
      "permissions": [{ "action": "x_create_posts", "resource": "*", "effect": "deny" }]
    }
  }
}
```

Don't put an `allow` or `ask` in the top-level `permissions`: a top-level rule comes after every agent's own rules, so
it would reach every agent, Explore included, which otherwise can't use X.

OpenCode uses the last rule that matches, so everything after the plugin's rules wins:

1. the agent's own rules, such as Explore's, which turn X off there;
2. your top-level `permissions`, which OpenCode adds to every agent;
3. your saved "Always allow" answers, which beat an `ask` but never a configured `deny`.

In an unattended run such as `opencode run`, a tool that asks is refused. An agent without the base rule gets no X
rules and keeps its own behaviour.

### Recipes

A `deny` can go in the top-level `permissions` of `opencode.json`: it applies to every agent, and only tightens. An
`allow` or `ask` goes in the agent's own `permissions`.

Never post, in any agent (a `deny` also hides the tool):

```json
[{ "action": "x_create_posts", "resource": "*", "effect": "deny" }]
```

Turn off every bookmark change, in one agent:

```json
{
  "agents": {
    "build": {
      "permissions": [
        { "action": "x_create_users_bookmark", "resource": "*", "effect": "deny" },
        { "action": "x_create_users_bookmark_folder", "resource": "*", "effect": "deny" },
        { "action": "x_delete_users_bookmark", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Make every X tool ask in one agent, reads included. The last match wins, so this `x_*` ask is the whole recipe:

```json
{
  "agents": {
    "build": {
      "permissions": [{ "action": "x_*", "resource": "*", "effect": "ask" }]
    }
  }
}
```

A write is approved per call, through the permission prompt. This plugin documents no `allow` for a write, the public
Post included: an "Always allow" saves an allow for every agent in the project, and a top-level `allow` would reach
Explore.

### Agents that miss the rules

OpenCode creates agents that exist only in your config after plugins add their rules, so those agents get no X rules;
agents that a later plugin adds are in the same position. An agent counts as guarded when the plugin's whole block
appears anywhere after its base allow. `/x-status` and `/x` list every other agent that has a base allow and where a
new X tool would run without asking, by name, followed by the default rules to paste. The next step reads:

```text
Put the default rules shown by /x-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for X tools.
```

Put the block first in that agent's own `permissions`, then repeat after it any top-level rules you have for `x_*`
tools, so yours keep winning. Never put the block in the top-level `permissions`: top-level rules come after every
agent's own rules, so it would loosen Explore. For an agent `reviewer`, with one top-level rule of your own:

```json
{
  "permissions": [{ "action": "x_create_posts", "resource": "*", "effect": "deny" }],
  "agents": {
    "reviewer": {
      "description": "Reviews changes",
      "mode": "subagent",
      "permissions": [
        { "action": "x_*", "resource": "*", "effect": "ask" },
        { "action": "x_get_news", "resource": "*", "effect": "allow" },
        { "action": "x_get_users_me", "resource": "*", "effect": "allow" },
        { "action": "x_create_posts", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Copy the full block from your own `/x-status` output: the sample above keeps the first two read allows and your own
rule, and leaves out the other 47.

## Scopes

The plugin requests only scopes that an allowed read or an asked write needs. No denied tool's scope is
requested, so X also refuses those tools at the account level. `offline.access` is not a tool scope: it is what makes
X issue a refresh token.

The scope or scopes X's endpoint documents; every one of them is in the pinned set. `space.read` covers
Spaces, `broadcast.read` your own broadcasts, their chat and moderators, and their sources, and `calls.read`
scheduled calls.

| Tool | Scope |
| --- | --- |
| `article_create_draft` | `tweet.write` |
| `create_lists` | `list.write` |
| `create_posts` | `tweet.write` |
| `create_users_bookmark` | `bookmark.write` |
| `create_users_bookmark_folder` | `bookmark.write` |
| `delete_users_bookmark` | `bookmark.write` |
| `get_broadcast` | `broadcast.read` |
| `get_broadcast_chat` | `broadcast.read` |
| `get_chat_moderators` | `broadcast.read` |
| `get_communities_by_id` | `tweet.read` |
| `get_lists_by_id` | `list.read` |
| `get_lists_followers` | `list.read, users.read` |
| `get_lists_members` | `list.read, users.read` |
| `get_lists_posts` | `list.read, tweet.read` |
| `get_news` | `tweet.read` |
| `get_posts_by_id` | `tweet.read` |
| `get_posts_by_ids` | `tweet.read` |
| `get_posts_counts_recent` | `tweet.read` |
| `get_posts_liking_users` | `like.read, tweet.read, users.read` |
| `get_posts_quoted_posts` | `tweet.read` |
| `get_posts_reposted_by` | `tweet.read, users.read` |
| `get_scheduled_broadcast` | `broadcast.read` |
| `get_scheduled_call` | `calls.read` |
| `get_source` | `broadcast.read` |
| `get_spaces_by_creator_ids` | `space.read` |
| `get_spaces_by_id` | `space.read` |
| `get_spaces_by_ids` | `space.read` |
| `get_spaces_posts` | `space.read, tweet.read` |
| `get_trends_by_woeid` | `tweet.read` |
| `get_usage_credits` | `tweet.read` |
| `get_users_blocking` | `block.read, users.read` |
| `get_users_bookmark_folders` | `bookmark.read, tweet.read` |
| `get_users_bookmarks` | `bookmark.read, tweet.read` |
| `get_users_bookmarks_by_folder_id` | `bookmark.read, tweet.read` |
| `get_users_by_id` | `users.read` |
| `get_users_by_username` | `users.read` |
| `get_users_by_usernames` | `users.read` |
| `get_users_followed_lists` | `list.read, users.read` |
| `get_users_liked_posts` | `like.read, tweet.read, users.read` |
| `get_users_list_memberships` | `list.read, users.read` |
| `get_users_me` | `users.read` |
| `get_users_me_followers` | `follows.read, users.read` |
| `get_users_me_following` | `follows.read, users.read` |
| `get_users_mentions` | `tweet.read, users.read` |
| `get_users_owned_lists` | `list.read, users.read` |
| `get_users_pinned_lists` | `list.read, users.read` |
| `get_users_posts` | `tweet.read, users.read` |
| `get_users_timeline` | `tweet.read, users.read` |
| `list_broadcasts` | `broadcast.read` |
| `list_scheduled_broadcasts` | `broadcast.read` |
| `list_scheduled_calls` | `calls.read` |
| `list_sources` | `broadcast.read` |
| `pin_list` | `list.write` |
| `search_communities` | `tweet.read` |
| `search_news` | `tweet.read` |
| `search_posts_all` | `tweet.read` |
| `search_spaces` | `space.read` |
| `search_users` | `users.read` |
| `unpin_list` | `list.write` |
| `update_lists` | `list.write` |

A `403` names the missing scope. Add it in the app's **User authentication settings**, then sign in again. This table
is the shipped minimum; X may change an endpoint's scope, in which case the `403` is the authority.

## Errors

Every error from the plugin reads `CODE: What happened. Next step: What to do.`

| Code | When | Next step |
| --- | --- | --- |
| `OPTIONS_INVALID` | Setup: an option is unknown or has a wrong value. `/x-status` shows the message, which names the option. | Fix the plugin options in `opencode.json`. |
| `HOST_UNTESTED` | Setup: OpenCode is outside `>=2.2.3 <2.3.0`, and `allowUntestedHost` is not set. | Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true`. |
| `CLIENT_ID_MISSING` | Setup: no X app client ID is in the options or the `/connect` X app entry. | Run `/connect` and choose X app, and paste your X app's client ID. |
| `CLIENT_ID_INVALID` | Setup: the saved client ID is empty or has spaces. | Save the client ID again from the app's User authentication settings. |
| `STATUS_UNAVAILABLE` | `/x-status`, `/x` or the status RPC: the status could not be read, or the plugin is not running on the server. The RPC answers with its error `unavailable`. | The message's own next step: restart OpenCode and run the command again, or, when the plugin is not running, run `/plugins` to see why. |
| `SKILLS_INVALID` | Setup: a skill file is missing or broken. The plugin still starts; status shows the problem. | Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | Setup: the `x` server could not be registered. Status shows the problem. | Restart OpenCode. |
| `RULES_NOT_ADDED` | Setup: the default permission rules could not be added, so X tools may run without asking. Status shows the problem. | Restart OpenCode. |

For example:

```text
OPTIONS_INVALID: Option apiKey: This option is not supported. Next step: Remove it. Supported options: oauth, allowUntestedHost.
```

Errors from X's server and from OpenCode pass through unchanged, except in the tools RPC for scripts, whose codes are
in [Scripting](scripting.md#errors). The X-specific ones worth knowing:

- `client-not-enrolled`: the app is not in Pay-per-use → Production. Move it, then try again.
- `403` on a bookmark or an Article: the token lacks `bookmark.write` or `tweet.write`. Add the scope, then sign in
  again.
- `429`: the endpoint's rate limit is used up. Wait for the reset X returns, and make fewer calls.

## Status and RPC

`/x-status`, the `/x` dialog and the RPC method `status` (RPC ID `x.posts`) share one status model. It holds no
token, no client secret and no URL query, and makes no X call, so reading it costs nothing. `version`, `host`,
`state`, `unguardedAgents` and `nextStep` are the fields every plugin of this family shares, with the same names and
meanings:

| Field | Content |
| --- | --- |
| `version` | The plugin's version |
| `state` | `connected`, `sign_in_required`, `connecting`, `disabled`, `failed`, `not_configured`, `conflict` or `host_untested`. The `Connection` row shows the same states as `connected`, `sign-in required`, `connecting`, `disabled`, `failed`, `not configured`, `conflict` and `host untested`. |
| `code`, `message` | For a setup state, or a missing or unusable client: `OPTIONS_INVALID`, `HOST_UNTESTED`, `CLIENT_ID_MISSING` or `CLIENT_ID_INVALID`, and one sentence on it. |
| `error` | For a failed connection only: OpenCode's reason, on one line of at most 160 characters, with any URL cut before its query. The text for a needed sign-in can hold an authorization URL, so it is never shown. |
| `source` | `type` (`plugin`, `adopted` or `conflict`), `url`, `signIn` (`oauth`, or `own` for your own entry with `"oauth": false`), and for a conflict the `expected` URL |
| `account` | The name OpenCode keeps on the active sign-in, on one line of at most 80 characters; absent when it keeps none. Status makes no X call, so the plugin learns nothing else about the account. |
| `client` | `id`, `mode` (`public_pkce` for a Native App, `confidential` when a secret is set) and `source` (`options` or `connect`). The `Client` row names `your own app` when it came from `/connect`, or `configured app` when it came from plugin options, as a team app does; status cannot tell managed config from a user's own options. The secret is never shown. |
| `callback`, `callbackPort`, `scopes` | The redirect URI the app must have registered, the local port for an `https:` redirect, and the scopes OpenCode requests |
| `tools` | How many X tools OpenCode lists that the default rules let run or ask: the listed ones, without the denied ones |
| `deniedTools`, `deniedCount` | The listed tools that the default rules deny, as safe plain names capped at 20, and the exact count: 40 when X lists them all. The `Tools` row shows them as "off by default" |
| `listing` | True while a server that connected moments ago lists no tools yet. The next step is then to run `/x-status` again in a few seconds, not to check the app. |
| `unknownCount`, `unknownTools` | How many of them the plugin does not know, and at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `unguardedAgents` | Agents where a new X tool would run without asking; empty when there are none. An agent whose own rules already ask or deny for every X tool is not listed. |
| `shadowedSkills` | Present only when a skill with one of the plugin's ids, such as your own `x` skill, replaces the plugin's: each `id` and the `path` OpenCode loads instead |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4 and 2.2.5) |
| `problems` | Setup problems, each `CODE: What happened. Next step: What to do.` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

The `Access` row states the posture the default rules fix: "reads run without asking; 9 tools ask first (bookmarks,
lists, an Article draft and a public Post); 40 are off (DMs and private chat conversations, calls, follows, blocks,
mutes, list membership, moderators and live video); X bills every tool call to the X developer account that owns the
app". Then it says whether those rules are in place: "no agent runs new X tools unasked", "default rules missing in the agents listed below", or "default rules
not added (see the OpenCode row)".

When the status cannot be read, the method answers with its error `unavailable`: the message
`STATUS_UNAVAILABLE: Could not read X's status (…).` and `data: { nextStep }`.
