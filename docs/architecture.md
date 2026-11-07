# Architecture

The plugin is a thin layer over X's official MCP server. OpenCode owns the MCP transport, OAuth, credentials,
permission prompts and tool output limits. The plugin registers the server with the user's own X app as its OAuth
client, names its `/connect` entries, adds default permission rules, reports status, ships two skills, and lets
scripts call the known tools through a tools RPC. It adds no tool of its own, makes no X call of its own, and has no
runtime dependencies.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | The server part: the plugin `x.posts`, pointed at X's server |
| `src/plugin.ts` | Setup, and server registration or adoption |
| `src/connect.ts` | The `/connect` **X app** entry, and the client resolution: options first, then the store |
| `src/server.ts` | The MCP server entry: X's URL and the static `oauth` block |
| `src/integration.ts` | The `/connect` entry for the server: its name "X", and the sign-in problem on its account |
| `src/listing.ts` | When the `x` server's status last changed, so status can tell a server still listing its tools from one that lists none |
| `src/options.ts` | Option parsing and validation, the `oauth` block included |
| `src/host-version.ts` | The host check: the supported range, and the tested releases |
| `src/x-tools.ts` | `READ_TOOLS`, `WRITE_TOOLS`, `PUBLIC_TOOLS`, `DENY_TOOLS`, `DENY_PATTERNS`, `PARAMETERS` and `classify()`: every fact the plugin keeps about X's tools. No runtime imports, so `scripts/check-x-tools.mjs` (`npm run drift`) can load it. `PARAMETERS` is recorded from the live input schemas, and is used by that script and the tests only |
| `src/permissions.ts` | The default rules, their placement, and detection of agents without them |
| `src/status.ts` | The status model and text, `/x-status`, and the status RPC method |
| `src/redact.ts` | Redaction for everything status shows: URL credentials, queries and token shapes removed, one line, controls and bidi characters stripped, cut by whole characters |
| `src/skills.ts` | Loading and registering the skills |
| `src/billing.ts` | The read cap (`execute.before`) and the actual cost line (`execute.after`), on the model path and in Code Mode |
| `src/host/tools-rpc.ts` | The tools RPC for scripts, `x.posts.tools`; a copy of a module shared by several plugins, with X's part in one marked block |
| `src/tui.ts` | The terminal UI part: the plugin `x.posts.tui` and the `/x` dialog |
| `src/constants.ts` | IDs, the server name and URL, the pinned callback and scopes, the Code Mode namespace description, the supported host range, the tested releases (`TESTED_HOSTS`, the one list the checks and status use) and the error shape. No imports, so `scripts/check.mjs` can load it |
| `src/version.ts` | The plugin's version from `package.json`; the build replaces it with the version string alone |

The default rules, the tools RPC's methods, status's unknown tools, the fake server in the tests and the checks of
`jelly.tools` and the skills all derive from `src/x-tools.ts`, so a change to X's tools is a change there, in
`jelly.tools`, and in any skill example that names a tool.

`scripts/build.mjs` bundles each entry with esbuild into one self-contained file: `src/index.ts` into `dist/index.js`
and `src/tui.ts` into `dist/tui.js`. Shared code, such as the status model and the RPC contract, is inlined into both.
The bundles have no chunks and no relative imports, because OpenCode reloads a plugin in place and keeps the modules it
already loaded for unchanged paths: an entry that imported a sibling module could get an older copy of it. Only
`@opencode/plugin`, OpenTUI, Solid and `node:` built-ins stay external, because the host provides them. `tsc` only
typechecks. The package exports `.` (`dist/index.js`) and `./tui` (`dist/tui.js`), plus the three icon files the family icon kit
adds, and ships no declaration files.
`dist/index.js` finds the skills at `../skills/` from its own URL, which is the package root's `skills/`.

## Setup

1. `parseOptions` validates `allowUntestedHost` and the `oauth` block. An unknown option or a wrong value is kept for
   status, not thrown; nothing else is set up.
2. `checkHost` compares `ctx.app.version` with `>=2.2.3 <2.3.0`, the same range as `opencode.host` in `package.json`.
   Inside it the plugin starts, and status calls only 2.2.3, 2.2.4 and 2.2.5 tested. Outside it, nothing is set up
   unless `allowUntestedHost` is set, and status says so.
3. The skills are read from the package's `skills/` folder, before the synchronous skill transform needs them.
4. When the client ID comes from `/connect` rather than the options, `registerAppIntegration` adds the **X app** key
   method, then `resolveClient` reads the options first and the stored entry second.
5. `ctx.mcp.transform` registers `x` at X's URL with the static `oauth` block: the client ID, the client secret when
   there is one, the pinned `redirect_uri` and the pinned scopes. It adopts the user's own entry at that URL, reading
   only its type, URL and whether `oauth` is `false`. Any other URL, or a local command, is a conflict. With no client
   and no user entry, it registers nothing and status asks for the app.
6. `ctx.tool.transform` gives the `x` namespace its Code Mode description, unless the name belongs to another server.
7. `ctx.agent.transform` inserts the default rules after each agent's base `* * allow`.
8. `watchListing` notes when the `x` server's status last changes. The plugin adds no tool hook.
9. `ctx.skill.transform`, `ctx.command.transform` (`/x-status`) and `ctx.rpc.register` (`x.posts/status`).
10. `registerToolsRpc` registers the tools RPC, `x.posts.tools`, and its `evaluate` hook.
11. `watchIntegration` starts, and a listener re-resolves the client on credential and integration events; a client
    saved or removed in `/connect` reloads the MCP config, and the server transform reads the new client on its
    replay. Setup returns one cleanup that stops all of them.

Transforms are synchronous and never throw: a failure is kept as a problem for status, and cleared when the next
replay succeeds.

## The `/connect` entries

`/connect` lists two entries for this plugin. **X** is the MCP server's own integration, which OpenCode creates for
every remote MCP server with OAuth. **X app** is the plugin's key method that stores the user's client ID.

OpenCode registers the server's integration after plugin setup, named after the server, and again on every MCP
reload, after the plugin's transforms. So `watchIntegration` checks the server's integration on `integration.updated`,
`mcp.status.changed` and credential events, and polls for the first ten seconds. When the name is not "X", it
registers a rename transform again, which then runs after the host's, and disposes the old one.

While the server is `needs_auth` and the integration has an active account, it reports
`{ status: "needs_auth" }` on that account with `ctx.integration.connection.status`, so `/connect` shows that a new
sign-in is required. `connection.active` returns the credential alone, so the plugin reads the status back from
`integration.get`, which projects it, and clears only its own message once the server is connected again. A user's own
entry with `"oauth": false` has no integration, so there is nothing to name.

## Status

`readStatus` reads the server's state (`ctx.mcp.list()`), the label of its active sign-in
(`ctx.integration.connection.active`), the `x` tools (`ctx.tool.list()`, by the namespace `x`), every agent's rules
(`ctx.agent.list()`) and the skills OpenCode lists (`ctx.skill.list()`). `buildStatus` turns them into one model, and
`formatStatus` renders it in a fixed order: Connection (state and server), Account (the sign-in's label, or "account
name not reported by X's MCP"), Access (the default rules' posture, and X's billing in one clause), Server, Client
(the client ID, a public or confidential mode, and its source, never the secret), Callback (the URL to register
exactly), Scopes, Tools (counts, and up to 20 unknown names), Agents without default rules (names, then the default
rules to paste, one rule a line), OpenCode (version, tested or not, the supported range, and setup problems), and
exactly one Next step, "Nothing to do." when nothing is needed. For 15 seconds after the server's status changes, no
tools means "still listing", not "none for this app", so the advice to check the app's package never shows while a
server that just connected lists its tools. When the app lists no tools once settled, the next step names X's three
traps: the Production environment, the Pay-per-use package and the scopes. An agent is listed only when it has a base
allow, lacks the plugin's whole block after it, and its own rules would let a new X tool run without asking. A skill of
the plugin's id that OpenCode loads from another path is named, with a next step to rename or move it. OpenCode's text
for a needed sign-in is never shown, and a failure's reason is cut to one line of 160 characters with no URL query.
Status makes no X call, because every call costs money.

- `/x-status` posts the text with `ctx.session.synthetic` (`resume: false`).
- The RPC method returns the model to the terminal UI and to scripts, with the fields every plugin of this family
  shares (`version`, `host`, `state`, `unguardedAgents`, `nextStep`). Its input and output are JSON Schemas that
  OpenCode validates. A status it cannot read is its declared error `unavailable`, with a next step. The UI part needs
  the RPC because on OpenCode 2.2.x it receives no plugin options and cannot see the server part's findings.

## Tools RPC

`x.posts.tools` lets a script call X's tools with no model; [Scripting](scripting.md) is the user's view. Its
methods are `describe` and one per entry in `METHODS`, which classifies every known tool by its exact name: the reads,
the private writes, the public send and the deny-by-default tools. A tool that X adds later is not a method.
`describe` reports each method's class, its availability from what OpenCode lists now, and, given a session, its
resolved permission. The model path is unchanged; the RPC's shapers reproduce its hooks: `shapeInput` allows X's 100
results and pagination and stops a session at its budget, and `shapeResult` appends the actual-cost line.

A call is `{ sessionID, input }`. The module:

1. looks up the session with `ctx.session.get`, and its agent's rules with `ctx.agent.get` in the session's location
   (`SESSION_UNKNOWN`, `SESSION_AGENT_REQUIRED`);
2. resolves the method's action against the agent's rules and then the session's, and refuses anything but `allow`
   (`PERMISSION_DENIED`): an `ask` cannot be answered, and a `deny` is hidden; either refuses before any tool call;
3. refuses with `SERVER_CONFLICT` while `x` is a user server at another URL; an adopted server is the plugin's;
4. without a client and without a user entry, refuses with `CLIENT_ID_MISSING` or `CLIENT_ID_INVALID` and the
   `/connect` next step;
5. finds the tool's executor in `ctx.tool.list()`, or names the server's connection state (`AUTH_REQUIRED` and so on)
   or `TOOL_UNAVAILABLE`;
6. calls `execute(input, { sessionID, agent, messageID, id, signal, progress })` with a new call id. OpenCode's
   executor checks `x_<tool>` on `*` itself, with the agent's rules, the session's rules and saved approvals, and
   sends OpenCode's own credential;
7. returns `{ output?, text }`: the executor's output (the tool's structured content, or OpenCode's copy of its text
   when it has none) and the tool's text parts.

While a call runs, its id is live. A `permission.hook("evaluate")` turns an `ask` whose source id is live into a deny,
so an inner action a method needs is named in the refusal and no prompt waits. It changes nothing else; this is the
plugin's only permission hook, and the forbidden scan allows exactly this one.

A `Tool.Error` with a cause is a permission refusal; one without a cause is X's own error (`isError`), which becomes
`UPSTREAM_ERROR` with its first line, at most 300 characters, with tokens and URL queries removed. Any other failure is
OpenCode's own and passes through.

OpenCode decodes a plain JSON Schema input with Effect, which drops unknown keys of an object that has properties
instead of refusing them. So the envelope's schema carries a strict Standard Schema validator as a non-enumerable
`~standard` property, which OpenCode prefers. The contract still reads and serialises as plain JSON Schema, and
OpenCode answers a bad envelope with `rpc.invalid_input`.

The executor does not run `execute.before` and `execute.after` hooks. The plugin has none to stand in for, so
`shapeResult` returns every result unchanged.

## Terminal UI part

`src/tui.ts` uses no JSX, because OpenTUI's JSX transform skips `node_modules`. One global keymap layer provides
"X: Status" (palette and `/x`) and the `r` key, which is enabled only while the dialog is open. The dialog is a
`ui.dialog.alert`, which closes on `Esc`. It listens to events only while it is open, and refreshes on
`mcp.status.changed` for `x`, `server.connected`, `agent.updated`, `integration.updated`, `credential.updated` and
`credential.switched`. The newest answer wins, and a refresh never reopens a closed dialog.

## Platform facts

These facts about OpenCode 2.2.3 hold on 2.2.4 and 2.2.5 too. Links point to the source at tag `v2.2.3`.

| Topic | Fact | Source |
| --- | --- | --- |
| MCP tool permissions | The host asserts every MCP call: action `<server>_<tool>`, resource `*`. A last-matching `deny` on `*` hides the tool. | [`tool/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/tool/mcp.ts) |
| Rule evaluation | The last match wins. Saved approvals come after all rules as `allow`. An unattended `ask` is refused. | [`permission.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/permission.ts) |
| Agent rule order | Built-in agents start from a base `* * allow` and exist before package plugins run. User `permissions`, and agents defined only in user config, come after. | [`config/plugin/agent.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/config/plugin/agent.ts) |
| User MCP config | `mcp.servers` is applied before package plugins. A later plugin `set` would replace the user's entry. | [`config/plugin/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/config/plugin/mcp.ts) |
| **Static-client sign-in** | With `oauth.client_id`, OpenCode logs `registration: "static"` and registers nothing. It never calls a registration endpoint, even when the authorization server metadata advertises one. It uses the entry's `oauth.client_secret` as `client_secret_basic` at the token endpoint, and sends no secret for a public client (`token_endpoint_auth_method: "none"`, PKCE S256). X advertises no registration endpoint and no client metadata documents, so a static client is the only route. The host test and the pack test assert no registration, the client ID, and basic authentication, on 2.2.3, 2.2.4 and 2.2.5. | [`mcp/oauth.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/mcp/oauth.ts) |
| **Public-client sign-in** | With no `oauth.client_secret`, OpenCode keeps `token_endpoint_auth_method: "none"`, uses PKCE S256, and sends the token request as a form with `grant_type`, `code`, `redirect_uri`, `client_id` and `code_verifier`, with **no** `Authorization` header. A refresh sends `grant_type=refresh_token`, `client_id` and `refresh_token`, again with no secret. The host test asserts the authorize URL, the code exchange and a refresh on 2.2.3, 2.2.4 and 2.2.5. X issued a public Native App a refresh token in the live test on 2026-11-06, and OpenCode refreshed it after about two
hours, so U7 is confirmed. | [`mcp/oauth.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/mcp/oauth.ts); the host test |
| **Pinned callback** | `oauth.redirect_uri` is used verbatim; without it OpenCode builds `http://127.0.0.1:<port>/callback` from an ephemeral port. It listens on `oauth.callback_port ?? the redirect's port ?? 0` on 127.0.0.1. X matches the redirect exactly, so the plugin pins `http://127.0.0.1:8766/callback`, and the tests assert that exact `redirect_uri` in the authorization request. | [`mcp/oauth.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/mcp/oauth.ts) |
| **Pinned scope** | OpenCode requests `oauth.scope` if the entry sets one, else the challenge's `scope`. X's 401 carries no `scope`, so the plugin pins `tweet.read users.read follows.read like.read block.read list.read list.write space.read broadcast.read calls.read bookmark.read bookmark.write tweet.write offline.access`, `offline.access` included, which is what makes X issue a refresh token. The authorization request carries exactly that string. | [`mcp/oauth.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/mcp/oauth.ts) |
| MCP integrations | Integration ID `mcp_` + the first 16 hex digits of sha1(`<name>\0<url>`), so credentials are kept per name and URL. | [`mcp/index.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/mcp/index.ts) |
| Code Mode | MCP tools are in Code Mode by default (`tools.x.<tool>`). A declined prompt is an error the program can catch. Each tool's signature, with its parameter names, reaches the model; a tool's full description reaches it only through `search()`, so the skills name every tool they use. | [`codemode/tool.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/codemode/tool.ts) |
| **Tool hooks** | `ctx.tool.hook("execute.before")` runs for an MCP call on the model path and inside Code Mode, and changing `event.input` changes the arguments the server receives. `ctx.tool.hook("execute.after")` can append to the result the model reads. Both hold on 2.2.3, 2.2.4 and 2.2.5 in isolation. The plugin caps a read there and appends its cost line; it never replaces `execute`. | The isolated host test of the two hooks on 2.2.3, 2.2.4 and 2.2.5 |
| **Tool descriptions** | `ctx.tool.transform`'s `editor.update` shallow-copies the tool, so `execute` and its permission assert survive: on 2.2.3, 2.2.4 and 2.2.5 a description rewrite still asks, and a declined call is refused before X is contacted. The one change is that a decline then raises an empty `Tool.Error` instead of `Permission.DeclinedError`, which hides the decline from the model. The plugin therefore does not rewrite `create_posts`'s description: the namespace text carries the public-and-price sentence, and in Code Mode a tool's full description reaches the model only through `search()`. | The isolated host test of `editor.update` on 2.2.3, 2.2.4 and 2.2.5 |
| Dialog close paths | A plugin's `ui.dialog.alert` resolves on its dialog's `onClose`. Opening another dialog (`replace`), `clear` (also a click outside), Escape and Ctrl+C all call `onClose` for each dialog they remove, so the `/x` dialog's `r` key and listeners stop on every path. | The pack test reads each stock release's terminal UI code for this |
| Sign-in label | `ctx.integration.connection.active` returns the active credential with a `label`. For an MCP sign-in OpenCode may keep no name there; the Account row then says so. Status makes no X call, so there is no other source. | `@opencode/plugin` 2.2.3 types |
| Credential status | A status set with `integration.connection.status` is not on what `connection.active` returns; `integration.get` projects it as `connections[].status`. A 401 whose token refresh fails removes the credential, so the `/connect` mark is only observable while a credential remains: with a token that has no refresh token. The host test signs in through the pinned loopback callback and the token endpoint, then challenges, and asserts the mark is set and cleared. | The host test, on 2.2.3, 2.2.4 and 2.2.5 |
| UI part options | The UI part of a plugin listed in `opencode.json` gets no plugin options. | Observed on stock 2.2.3, 2.2.4 and 2.2.5 |
| Tool executors | `ctx.tool.list()` returns each MCP tool with a callable `execute`, which checks `<server>_<tool>` with the agent's and the session's rules and saved approvals, and gives the `evaluate` hook the call's `source`. A deny is a `Tool.Error` with a cause; the server's `isError` is one without. A direct call of that executor runs no `execute.before` or `execute.after` hook; a model turn and Code Mode do. Not documented as an entry point: the package test checks it on stock 2.2.3, 2.2.4 and 2.2.5. | [`tool/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/tool/mcp.ts) |
| RPC input | An RPC input given as a Standard Schema is validated with it; a plain JSON Schema is decoded with Effect, which drops unknown keys of an object that has properties. The package test checks the envelope on stock 2.2.3, 2.2.4 and 2.2.5. | `@opencode/core` 2.2.3, the RPC service's `parse` |
