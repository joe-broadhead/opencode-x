# Scripting

A script can call X's tools with no model: a cron job, a shell script, or any program that can reach the OpenCode
server. It uses the tools RPC, `x.posts.tools`, through `opencode api` or an OpenCode client.

| Method | The tool |
| --- | --- |
| one per known X tool, named after it: `search_posts_all`, `get_users_me`, `create_users_bookmark`, `create_posts` and the others | `x_<method>` |
| `describe` | none: lists every method with its class, its permission action, whether OpenCode lists its tool now, and its input as JSON Schema; given a session, it also gives each method's `permission` |

The methods are exactly the tools this plugin knows (`METHODS` in `src/host/tools-rpc.ts`): the 51 reads, the 8 private
writes, the public `create_posts`, and the 40 tools that were once off and now follow the same `access` block. A tool X adds later is not a method until
the plugin classifies it, so a script never reaches one.

Each method runs the tool with the same input: X's own tool, through OpenCode's own connection and sign-in. The plugin
never sees the OAuth token.

## Every call costs money

X bills every call to the X developer account that owns the app. A post read is about $0.005, a user read about
$0.010, a read of the user's own posts, mentions or bookmarks about $0.001, a bookmark change about $0.005, and a
recent count about $0.005. Lists, Spaces, Communities, news and DM resources have their own rates in the plugin's price
table, from [X's pay-per-usage pricing](https://docs.x.com/x-api/getting-started/pricing) read on 2026-11-08.

- **Every billable method is priced.** A method with no published price is refused with `X_PRICE_UNKNOWN` before any X
  call, never run for free. Writes are priced at their request rate, including a Post at $0.015, or $0.200 with a URL.
- **The estimate comes first.** Before dispatch the tools RPC multiplies the page size (`max_results`, or 1) by the
  resource rate and adds any per-request price. If that estimate does not fit the session or the rolling daily budget,
  the call is refused with `X_BUDGET_EXCEEDED`, the remaining amounts, and a next step; no X call is made.
- **Two caps.** `scriptBudgetUsd` caps one session, **$1.00** by default. `scriptDailyBudgetUsd` caps all script
  spending in a rolling 24 hours, **$1.00** by default, across sessions, scheduled jobs and reloads. `X_BUDGET` is the
  old single code; it is now `X_BUDGET_EXCEEDED`. Raise either option, or wait for the window to roll.
- **The ledger persists.** It is kept in the plugin's storage as amounts and timestamps only, with no content, so a
  reload does not forget the spend.
- **The script sees its cost.** Every result carries the actual cost line, computed from what X returned, and a
  structured `cost: { estimateUsd, actualUsd, sessionSpentUsd, dailySpentUsd }` beside the output. Where X reports no
  usage the actual is the estimate. Example: `Cost: 10 posts ($0.05) + 10 authors ($0.10) = $0.15.`
- **A script's page is not the model's page.** The model path keeps one page of ten; a script, whose code you approved,
  may ask for up to X's maximum of 100 and for a next-page token. A loop is still a loop: 500 posts cost about $2.50,
  and the budget, not the page size, bounds it; the estimate refuses the call that would cross a cap.
- **Bookmarks need a daily cadence.** `get_users_bookmarks` has no `since_id`; every poll re-reads the newest page, and
  X charges a resource once in a 24-hour UTC window. Poll once a day, not every few minutes; a 15-minute schedule buys
  the same page many times and gains nothing.
- A script goes through the tools RPC, which calls the tool executor directly: no `execute.before` or `execute.after`
  hook runs, so it is not capped by the model's ten and gets no hook cost line. The tools RPC's own estimate and
  `shapeResult` cost line replace them.

## Rate limits

X applies per-endpoint, per-user windows, usually 15 minutes. A `429` carries `x-rate-limit-reset`, the time the
window reopens; wait for it rather than retrying. A script shares the limits with the model's calls under the same
sign-in, so make calls one at a time, never in parallel.

A script's errors from the tools RPC are in [Errors](#errors).

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with the access its
model has. **A rule must allow the tool before the call**: `agent.permissions` then `session.permissions`, the same
order the host uses, and the last matching rule wins. Only `allow` runs.

- No one answers a prompt for a script, so a rule that resolves to `ask` is refused with `PERMISSION_DENIED` before
  the tool runs, and no prompt is left waiting.
- A rule that resolves to `deny` is refused too, and names the rule to change.
- The plugin's default rules allow the reads and ask for every write, so a **read** needs nothing more. A **write**,
  the public `create_posts` and an off-by-default tool need an explicit `allow` in the session's or the agent's rules.
- A saved "Always allow" from an earlier prompt does **not** authorize an ad-hoc script: it is not part of the
  agent's and session's rules, and a script's grant must be reviewable in config or in a job's approval. This is the
  one deliberate break from the earlier reads-only RPC.
- The session must belong to the location you call. A session in another directory is `SESSION_UNKNOWN`.

Create the session once, with the agent the script runs as, and keep its id. Never reuse a session found through
history or a list: the script would run as that session's agent, under its rules.

```sh
opencode api post /api/session -d '{"title":"daily mentions","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do, and it can grant one write for
one script without touching the agent's rules. This one can only post a bookmark and search posts:

```sh
opencode api post /api/session -d '{"title":"bookmark sync","agent":"build","permissions":[
  {"action":"x_*","resource":"*","effect":"deny"},
  {"action":"x_search_posts_all","resource":"*","effect":"allow"},
  {"action":"x_create_users_bookmark","resource":"*","effect":"allow"}
]}'
```

A session rule also applies to that session's model turns. Create a session for the script alone.

For a grant bound to the exact script the user approved, use a Jobs one-off script job: its approval writes the run
session's `allow` rules, and the user sees the source, the methods and whom each write reaches before it exists.

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/x.posts.tools/<method> -H "x-opencode-directory:$PWD" -d '{…}'
```

Without it the call goes to the service's default location and fails `rpc.unavailable` if the plugin is not loaded
there. The HTTP equivalents are the `location[directory]` query parameter and the same header. `describe` reports the
`location` that answered and a `locationHint`.

A location unloads after OpenCode's idle timeout. If a scheduled script gets `rpc.unavailable` from a location that was
loaded before, send the call again once: the request loads the location. Jobs keeps its own location loaded.

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed.

Send the location explicitly with `-H "x-opencode-directory:$PWD"`. Without it, the call goes to the service's
default location, which can be another project: there the session is unknown, or the plugin is not loaded. The HTTP
equivalents are the `location[directory]` query parameter and the same header.

```sh
opencode api post /api/rpc/x.posts.tools/search_posts_all \
  -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{"query":"from:example","start_time":"2026-01-01T00:00:00Z","end_time":"2026-01-08T00:00:00Z","max_results":10}
}}'
```

The tool's input is X's, and X defines its fields and may change them: `describe` shows each tool's schema as
OpenCode lists it now. Check it rather than guess a field name or a filter's shape. A date window is RFC 3339 UTC
(`start_time` and `end_time`, ending in `Z`); X's search has no web-style date operator.

An X Article's full text comes from `get_posts_by_ids` with `post.fields=article`: each post's `article.plain_text`
holds the Article's text. The request costs the post read, and the text is as untrusted as any other post.

```sh
opencode api post /api/rpc/x.posts.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/x.posts.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

`describe` with a session gives each method's `class` (`read`, `write`, `send`, `export` or `destructive`) and its
resolved `permission` (`allow`, `ask` or `deny`). That is how a script self-checks before it writes a call.

A result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts joined by
newlines. This plugin also puts `cost: { estimateUsd, actualUsd, sessionSpentUsd, dailySpentUsd }` inside `output`. Jobs' bridge returns `output` when present, so a Jobs script receives the cost with it. X content in it, such as posts, bios and Article text, is untrusted data
written by other people: keep what a script writes where the people it is about would expect it, and only as long as
you need it.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to
standard output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The rules resolve to `ask` (a script cannot answer) or to `deny`. The message names the action; the next step names the rule to add or remove. |
| `X_BUDGET_EXCEEDED` | The call's estimate does not fit the session's `scriptBudgetUsd` or the rolling `scriptDailyBudgetUsd`. No X call is made; the error gives the remaining amounts and the option to raise. |
| `X_PRICE_UNKNOWN` | The method has no published price in the plugin's table. It is refused before any X call, never run for free. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `x` server at a URL other than X's. `/x-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `x` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/x-status` gives the details. |
| `CLIENT_ID_MISSING`, `CLIENT_ID_INVALID` | No X app client ID is set, or the saved one is unusable. The next step is the `/connect` X app entry. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool: X may list fewer tools for a token with fewer scopes. |
| `UPSTREAM_ERROR` | X answered with an error, such as an invalid input, a missing post or a rate limit. The message holds the first line of X's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a tool X added later, and
`rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but `{}`, nothing, or `{sessionID}` | `describe takes nothing, or {"sessionID":"<session>"}` |

## What scripts cannot do

- Call a tool this plugin does not classify, even with an allow rule.
- Run a write, the public Post or an off-by-default tool without a prior explicit `allow` in the agent's or the
  session's rules. A saved "Always allow" is not enough.
- Answer an approval prompt: an `ask` is refused.
- Use a token or key: the plugin has none to give.
- Read X without a bill, or past the session's budget.
