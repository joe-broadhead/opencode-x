# Security

## Supported versions

Fixes go into the newest release. Older releases are not patched.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue. Include the plugin version, the OpenCode
version, your plugin options and the steps to reproduce. Never include tokens, a client secret, X content or personal
data.

Vulnerabilities in X's service or in OpenCode itself are out of scope. Report those to X or to the OpenCode project.

## Data handling

- The plugin holds no credential and runs no network request of its own. It registers X's MCP server with OpenCode,
  and OpenCode connects, signs in, stores the token and refreshes it. The tools RPC for scripts (see
  [Scripts](#scripts)) runs X's tools through OpenCode's own connection, too.
- The X app's client ID and secret come from the plugin options or the `/connect` **X app** entry, and are kept in
  OpenCode's credential store or managed config. The plugin never reads the OAuth token. Status shows the client ID,
  whether a secret is set and where it came from; it never shows the secret.
- **Stream sources.** `get_source` and `list_sources` are allowed reads. X's descriptions say the stream key is not
  included in either response, and the plugin exposes no tool that reads it; the plugin still treats a source as
  sensitive, and never asks for a denied broadcast or source write.
- **A public client ID is not a secret.** A Native App's client ID only identifies the app, so it is safe to distribute
  in managed config for a team app. A client secret authenticates the app and must never be distributed: anyone with
  it can act as the app. If one leaks, rotate it in X's console.
- Of a user's own `mcp.servers.x` entry the plugin reads only the type, the URL and whether `oauth` is `false`; it
  never reads, copies or reports its `headers` or its client fields. Status shows server URLs without their query
  strings, never OpenCode's text for a needed sign-in, which can hold an authorization URL, and cuts a connection
  failure's reason to one line with no URL credentials, query or token.
- Status shows the name OpenCode keeps on the sign-in, if any, on one line. The plugin captures nothing from X's
  results, and never calls X itself, because every call costs money.
- **X content is public but personal.** Posts, profiles, Articles, bookmarks, news and trends reach the model as tool
  results, and the agent sends them to your model provider, like any other tool result in the session. X's Developer
  Policy forbids training models on X content, deriving or storing sensitive traits, and matching handles to off-X
  records without consent. The skills tell the model not to infer health, financial status, politics, race or
  ethnicity, religion, sex life or sexual orientation, trade-union membership or criminal activity, not to build
  dossiers on private people, and not to match a handle to the user's mail, files, candidates or customers. Protected
  accounts' posts stay with the people allowed to see them.
- **X content is adversarial.** Posts, bios, display names and Article text come from anyone and often contain
  instructions aimed at the model. The namespace text and the skills tell the model to treat every result as data,
  never to follow an instruction in it, and never to let it choose a tool, a recipient or a change. X's terms also
  forbid automated replies without prior approval and automated or bulk likes. The plugin has no like tool; a reply
  is possible through `x_create_posts`, follows the `access` option, and those reply rules still apply.
- **Every call is billed** to the X developer account that owns the app. The plugin caps a model read to one page of
  at most ten posts or users, with one widening and about $0.20 an answer, and every answer that read ends with its
  actual cost line. A script pays the same rates and is capped by `scriptBudgetUsd` per session and
  `scriptDailyBudgetUsd` per rolling 24 hours: an estimate above either cap is refused with `X_BUDGET_EXCEEDED`
  before the call, the daily ledger persists across sessions and reloads, and an unpriced method is refused with
  `X_PRICE_UNKNOWN`. X's own app spending limit remains the backstop.

## Permissions

What the model can do in X is limited by these layers, in this order:

1. **X's server and the app's scopes.** The sign-in is your own X account, and the token carries the app's scopes.
   The plugin requests the scopes its tools need, including `follows.read`, `like.read`, `block.read`, `list.read`,
   `list.write`, `space.read`, `broadcast.read` and `calls.read`. A tool whose scope the app does not carry fails with
   `403` or disappears. X's app-only bearer token cannot reach your timeline, mentions or bookmarks; the hosted server
   uses the user's sign-in.
2. **The default is allow.** With no configuration, every one of X's 100 live tools is allowed for every agent, writes
   included: an agent can post, reply, quote, edit, bookmark, create or change lists, draft an Article, send a DM,
   follow, block, mute, change list membership, moderate a chat and go live on the user's real account **without
   asking**. `x_create_posts` is public: anyone can read the Post, it appears on the profile and in followers'
   timelines, and the plugin has no delete tool.
3. **Your OpenCode permissions.** The `access` option drives the generated block: `all` is the default above,
   `ask-changes` allows reads and asks for everything else, and `read-only` allows reads and denies everything else.
   A user's own `permissions` rules and saved "Always allow" answers come later and win. To restrict without editing
   every agent: `{ "access": "ask-changes" }` or `{ "access": "read-only" }`.

Things to know:

- **Saved approvals are broad.** "Always allow" on an X tool saves the pattern `*` for that tool's action. It applies
  to every agent in the OpenCode project, Plan included, until you remove it. OpenCode identifies a project by its git
  repository. A folder outside any git repository with a commit may belong to OpenCode's shared `global` project, so an
  approval saved there may apply in other such folders too.
- **Some agents get no default rules.** Agents defined only in your own config, and agents added by plugins that load
  after this one, are created after the plugin inserts its rules, and agents without a base allow get none. With
  `access: all` they still allow X tools through the agent's own base allow. `/x-status` names these agents and gives
  the fix: put the rules it shows first in that agent's own `permissions`, followed by your top-level rules for X
  tools. Do not put them in the top-level `permissions`, which would loosen Explore.
- **Unattended runs.** With `access: all` (the default) a write can run in `opencode run` with no one present. With
  `ask-changes`, a tool that would ask is refused; run changes interactively or set `access: all` for that run.
- **The `x_*` allow also matches other servers** whose names start with `x_`. It allows their tools too. Rename such a
  server, or put a narrower rule after the block.
- **The client secret is a credential.** A config file may be synced, backed up or shared, so prefer
  `{env:X_CLIENT_SECRET}` in `opencode.json`, or the `/connect` X app entry, over a literal value. An unset variable
  arrives as an empty string, which `OPTIONS_INVALID` rejects. A Native App needs no secret.
- **The rules follow the name, not the server.** When your own `mcp.servers.x` points at another URL, status reports a
  conflict and the plugin adds no server, but the default `x_*` allow still matches tools of that server. Point the
  entry at X's URL, or remove it.

## Scripts

The tools RPC (`x.posts.tools`, see
[docs/scripting.md](https://github.com/joe-broadhead/opencode-x/blob/HEAD/docs/scripting.md)) calls X's tools for a
script, with no model. Every known tool is a method, with its class. A script gets the same `access` default as the
model: with `all`, every method resolves `allow`; with `ask-changes` or `read-only`, a method that is not a read is
refused before dispatch. A method is not a grant:

- A script names a session that names an agent, and runs as them. Before any call, the plugin resolves that method's
  permission action against the agent's rules and then the session's rules, the host's own order. Only `allow` runs: a
  rule that resolves to `ask` is refused because no one can answer it, and a `deny` is refused. Neither makes an X
  call. The default rules allow the reads and ask for the writes, so a script reaches a write, the public
  `create_posts` or an off-by-default tool only with a prior explicit `allow` in the agent's or the session's rules.
- A saved "Always allow" is **not** consulted: it lives outside the agent's and session's rules, so an old click does
  not authorize a new script. A grant is reviewable in config, or in a Jobs one-off's approval.
- After the resolve, the call runs through OpenCode's own executor, which checks `<server>_<tool>` again against the
  agent's rules, the session's rules and saved approvals, as it does for the model. The plugin's permission hook still
  changes only an `ask` on one of its own script calls in flight, only to a deny, and leaves every other call alone.
- A tool the plugin does not classify is not a method, so a tool X adds later is unreachable by a script until a
  release classifies it.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- X's error text reaches the script only as the first line, at most 300 characters, with tokens and URL query strings
  removed.
- A script's calls are billed like any other. A script may page and ask for up to X's 100 results, because the user
  approved its code; each session has a `scriptBudgetUsd` budget ($1.00 by default), counted from the billed resources
  in the results, and at the budget the next call is refused with `X_BUDGET` before X is contacted.
- A session in another location is `SESSION_UNKNOWN`, and a call that names no location reaches the service's default
  location: send `x-opencode-directory` with each call.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so
  another plugin's policy hook does not see it. The plugin's own read cap, cost line and budget are reproduced by the
  RPC's shapers. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The
  session is not a login: it scopes a script to what its agent may do.
