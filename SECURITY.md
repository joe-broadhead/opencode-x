# Security policy

## Supported versions

Only the latest release tag is supported. The plugin refuses an OpenCode release outside `>=2.4.1 <2.5.0` with
`HOST_UNTESTED` unless the person sets `allowUntestedHost`.

## Reporting a vulnerability

Do not open a public issue. Use the repository's private security advisory form
(`https://github.com/we-the-rebel-alliance/x-plugin/security/advisories/new`) with:

- the affected version or commit;
- the smallest reproduction, including the options and the call;
- the impact you observed.

The maintainers acknowledge the report and agree a disclosure date with you. Please do not include a real token, an X
app secret or another person's data in the report; a redacted value is enough.

## What the plugin can and cannot see

- Account credentials live in OpenCode's MCP store; the plugin never reads, prints or stores a token.
- The X app's client secret is read from the environment variable the profile names, at setup, and passed to OpenCode's
  MCP configuration. It is never written to options, docs, logs or status.
- Failure reasons are redacted (URL query values, `Bearer`/`Basic` credentials, JWTs and token-shaped words) and cut to
  160 characters before they reach status, a log or a model.
- A page's events are `trust: "untrusted"`; their text is data and is never followed as an instruction.
- The plugin has no write path of its own. X's writes are the vendor's MCP tools, run under OpenCode's permission
  rules.

See [docs/security.md](docs/security.md) for the scopes, the access levels and the redaction rules.
