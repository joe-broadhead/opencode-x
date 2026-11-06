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
- **Stream sources can carry a secret.** `get_source` and `list_sources` return a user's RTMP/RTMPS ingest point; X's
  source object holds the stream URL and its key, which lets anyone publish to that stream. The captured live list
  has no output schema, so the plugin cannot confirm the shape, and both tools stay ask. Treat a source as a
  credential, and never put its key in a message, a file or another tool.
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
  forbid automated replies without prior approval and automated or bulk likes; the plugin exposes neither.
- **Every call is billed** to the X developer account that owns the app, and the plugin cannot cap the bill. The skill keeps calls to
  the smallest page, says when a search is wide, and never pages a search in a loop. A script pays the same rates; a
  spending limit in X's console is the backstop.

## Permissions

What the model can do in X is limited by these layers, in this order:

1. **X's server and the app's scopes.** The sign-in is your own X account, and the token carries the app's scopes.
   Without `bookmark.write` or `tweet.write`, those tools fail with `403` or are not listed. X's app-only bearer token
   cannot reach your timeline, mentions or bookmarks; the hosted server uses the user's sign-in.
2. **Default permission rules.** Every X tool asks before it runs, except the read tools listed in `src/x-tools.ts`,
   which run without a prompt. Every change asks, and `x_create_posts` is public: anyone can read the Post,
   it appears on the user's profile and in followers' timelines, and the plugin has no delete tool. No tool X offers today is
   denied; `DENY_PATTERNS` in `src/x-tools.ts` and the last rules of `defaultRules()` deny a future DM, follow,
   block, mute, post-delete, list-membership or account-settings tool by its effect, before any release classifies
   it.
3. **Your OpenCode permissions.** Your `permissions` rules and saved "Always allow" answers override the default
   rules. A `deny` you configure always wins.

Things to know:

- **Saved approvals are broad.** "Always allow" on an X tool saves the pattern `*` for that tool's action. It applies
  to every agent in the OpenCode project, Plan included, until you remove it. Think twice before saving one for
  publishing. OpenCode identifies a project by its git repository. A folder outside any git repository with a commit
  may belong to OpenCode's shared `global` project, so an approval saved there may apply in other such folders too.
- **Some agents get no default rules.** Agents defined only in your own config, and agents added by plugins that load
  after this one, are created after the plugin inserts its rules, and agents without a base allow get none. X tools
  may run there without asking. `/x-status` names these agents and gives the fix: put the default rules it shows first
  in that agent's own `permissions`, followed by your top-level rules for X tools. Do not put them in the top-level
  `permissions`, which would loosen Explore.
- **Unattended runs refuse prompts.** In `opencode run`, an X tool that would ask is refused, so run changes
  interactively.
- **The `x_*` rule also matches other servers** whose names start with `x_`. For their tools it only adds prompts.
- **The rules follow the name, not the server.** When your own `mcp.servers.x` points at another URL, status reports a
  conflict and the plugin adds no server, but the default rules still allow the known read names, so a tool of that
  server with such a name runs without asking. Point the entry at X's URL, or remove it.
- **The client secret is a credential.** A config file may be synced, backed up or shared, so prefer
  `{env:X_CLIENT_SECRET}` in `opencode.json`, or the `/connect` X app entry, over a literal value. OpenCode substitutes
  the variable when it loads the config; an unset variable arrives as an empty string, which `OPTIONS_INVALID`
  rejects. A Native App needs no secret: its sign-in is covered by the checks, though X's refresh token for a public
  client is unconfirmed live.

## Scripts

The tools RPC (`x.posts.tools`, see
[docs/scripting.md](https://github.com/joe-broadhead/opencode-x/blob/HEAD/docs/scripting.md)) runs X's known read tools
for a script, with no model. It adds no authority:

- A script names a session that names an agent, and runs as them. A tool that the agent's or the session's rules hide
  from the model is refused. OpenCode's own executor then checks the call against the agent's rules, the session's
  rules and saved approvals, as it does for the model. A session in another directory than the server answering the
  call runs under the serving location's agent rules, and only a deny is refused in between: the README's known limits
  say so.
- An ask on a script's call is denied, not prompted: no one is there to answer it. The plugin's permission hook
  changes only an ask on one of its own script calls in flight, only to a deny, and leaves every other call alone.
- Only the known reads are methods. The bookmark and list changes, the Article draft, the public `create_posts` and
  a tool that X adds later never are, even with an allow rule.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- X's error text reaches the script only as the first line, at most 300 characters, with tokens and URL query strings
  removed.
- A script's calls are billed like any other. Keep the result count small, make calls one at a time, and never page in
  a loop.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so
  another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The
  session is not a login: it scopes a script to what its agent may do.
