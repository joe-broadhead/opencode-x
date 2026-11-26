# Security

## What leaves the machine

Only X. The plugin's own calls are the vendor MCP server's tools, executed by OpenCode against X's hosted server at
`https://api.x.com/mcp`. Nothing is sent anywhere else: no telemetry, no proxy, no third-party service.

## Credentials

- The account's OAuth token lives in OpenCode's MCP store, keyed per server (`x`, `x-work`, …). The plugin never reads
  it, prints it or puts it in a fixture.
- The X app's client id is a profile field. Its client secret is named by `clientSecretEnv` and read from the process
  environment at setup; the secret itself is never written to options, docs, logs or status.
- A failure reason is redacted before it is shown: URL query values, `Bearer`/`Basic` credentials, JWTs and
  token-shaped words are replaced, control characters become spaces, and the line is cut to 160 characters.
- `probe` and `events_list` name only the X handle; they never echo a token or a raw provider error body.

## Scopes

The sign-in asks for `tweet.read`, `users.read`, `follows.read`, `like.read`, `block.read`, `list.read`, `list.write`,
`space.read`, `broadcast.read`, `calls.read`, `bookmark.read`, `bookmark.write`, `tweet.write`, `media.write` and
`offline.access`. They are pinned because X's 401 names none, not widened per call. A person who wants fewer scopes
removes them from the X app before signing in; a tool that needs one is then absent or refused, and the plugin answers
`UNAVAILABLE` or `SCOPE_MISSING`, never a workaround.

## Least privilege

`access` defaults to `all` (the standard's default) and can be narrowed:

- `ask-changes` runs reads and asks before every write, send, delete, export and admin tool;
- `read-only` runs reads and turns every other class off;
- six private reads (private chat conversations and public-key reads) ask under `ask-changes` and are off under
  `read-only` through their `effect: "ask"`.

The rules are generated per alias, so a rule for `work` never reaches `personal`'s tools. A method's `effect` can only
narrow the level; there is no way for a method to widen it. A grant fence, when an app reads a source, allows only that
source's method and its X tool for the granted alias.

## No write of its own

The plugin has no plan/commit pair and no `actions` entry: X's writes are the vendor's MCP tools, and OpenCode's
permission rules decide whether one runs. The plugin therefore emits no bus event: `changed` is for a write the plugin
itself makes, and it makes none.

## Untrusted content

Posts, bios, display names, Article text, news summaries and trend names are written by anyone. Every event is
`trust: "untrusted"`, and the plugin never follows, executes or re-emits their text as an instruction. A post whose
text holds a credential is refused for good (`refused[]`, reason `secret`) and does not reach a consumer.

## Reporting a vulnerability

Do not open a public issue for a security problem. Report it privately to the maintainers through the repository's
security advisory form, with the version, the smallest reproduction and the impact. The maintainers acknowledge it and
agree a disclosure date with you.
