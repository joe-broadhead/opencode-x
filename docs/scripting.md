# Scripting

A script can call X's read tools with no model: a cron job, a shell script, or any program that can reach the
OpenCode server. It uses the tools RPC, `x.posts.tools`, through `opencode api` or an OpenCode client.

| Method | The tool |
| --- | --- |
| one per known read, named after X's tool: `search_posts_all`, `get_users_me`, `get_users_timeline` and the others | `x_<method>`, such as `x_search_posts_all` |
| `describe` | none: lists the methods, their permission actions, whether OpenCode lists each tool now, and each tool's input as JSON Schema |

The methods are exactly the read tools that the plugin knows, the ones its default rules allow (`READ_TOOLS` in
`src/x-tools.ts`). Call `describe` for the list: X may list fewer tools for a token with fewer scopes, so `describe`
marks a known read that X does not offer you as unavailable.

Each method runs the tool with the same input: X's own tool, through OpenCode's own connection and sign-in. The plugin
never sees the OAuth token. X's bookmark changes, `create_users_bookmark_folder`, `article_create_draft`,
`article_publish` and a tool that X adds later are never methods, even with an allow rule.

## Every call costs money

X bills every call to the user's X API credits. A post read is about $0.005, a user read about $0.010, a read of the
user's own posts, mentions or bookmarks about $0.001, and a bookmark change about $0.005. A search page holds 10 to
100 posts, so a 100-post page is about $0.50.

- Set the smallest result count the tool's schema allows; `describe` gives the field names.
- Never page in a loop. A script that pages through 500 posts costs the user about $2.50 for one run.
- The same resource read twice in a 24-hour window is charged once; a new page is not.

## Rate limits

X applies per-endpoint, per-user windows, usually 15 minutes. A `429` carries `x-rate-limit-reset`, the time the
window reopens; wait for it rather than retrying. A script shares the limits with the model's calls under the same
sign-in, so make calls one at a time, never in parallel.

A script's errors from the tools RPC are in [Errors](#errors).

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with the access its
model has:

- A tool that the agent's rules or the session's rules hide from the model is refused. OpenCode hides a tool when the
  last rule that matches its permission name, such as `x_search_posts_all`, on resource `*` is a `deny`.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.
- No one answers a prompt for a script, so an `ask` is refused with `PERMISSION_DENIED` at once, and no prompt is left
  waiting. The plugin's default rules allow the reads, so an agent with the default rules needs nothing more. An agent
  defined only in your config gets no default rules; `/x-status` names it.

Create the session once, with the agent the script runs as, and keep its id. Never reuse a session found through
history or a list: the script would run as that session's agent, under its rules.

```sh
opencode api post /api/session -d '{"title":"daily mentions","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can search posts and
read the user's account, and nothing else in X:

```sh
opencode api post /api/session -d '{"title":"daily mentions","agent":"build","permissions":[
  {"action":"x_*","resource":"*","effect":"deny"},
  {"action":"x_search_posts_all","resource":"*","effect":"allow"},
  {"action":"x_get_users_me","resource":"*","effect":"allow"}
]}'
```

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed.

```sh
opencode api post /api/rpc/x.posts.tools/search_posts_all -d '{"input":{
  "sessionID":"ses_…",
  "input":{"query":"from:example since:2026-01-01","max_results":10}
}}'
```

The tool's input is X's, and X defines its fields and may change them: `describe` shows each tool's schema as
OpenCode lists it now. Check it rather than guess a field name or a filter's shape.

```sh
opencode api post /api/rpc/x.posts.tools/describe -d '{"input":{}}'
```

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the tool's
text>}}`, as plain JSON. X content in it, such as posts, bios and Article text, is untrusted data written by other
people: keep what a script writes where the people it is about would expect it, and only as long as you need it.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to
standard output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The agent's or the session's rules deny the tool, or ask for an approval. A deny names the denied action, such as `x_search_posts_all`, and its next step says to remove or narrow that deny rule, add a later allow rule to the session, or use a session whose agent allows it. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `x` server at a URL other than X's. `/x-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `x` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/x-status` gives the details. |
| `CLIENT_ID_MISSING`, `CLIENT_ID_INVALID` | No X app client ID is set, or the saved one is unusable. The next step is the `/connect` X app entry. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool: X may list fewer tools for a token with fewer scopes. |
| `UPSTREAM_ERROR` | X answered with an error, such as an invalid input, a missing post or a rate limit. The message holds the first line of X's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a write tool or a tool X
added later, and `rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but `{}` or nothing | `describe takes no input` |

## What scripts cannot do

- Change anything in X: no write tool is a method.
- Publish an Article: `article_publish` is public and is never a method.
- Call a tool that is not one of the known reads, even with an allow rule.
- Answer an approval prompt, or use a tool that asks.
- Use a token or key: the plugin has none to give.
- Read X without a bill: every call is charged to the user's credits.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them.
