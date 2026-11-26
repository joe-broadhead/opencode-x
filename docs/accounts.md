# Accounts

Every alias is one X account, and its credential lives in the vendor's MCP server: one server per alias, so
OpenCode's own OAuth state keeps them apart. A refused refresh is that alias's `needs_sign_in`, never a shared failure.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

| Field | Type | Required |
|---|---|---|
| `clientId` | string | no |
| `clientSecretEnv` | string | no |
| `redirectUri` | string | no |
<!-- /generated:accounts -->

## Servers and sign-in

| Alias | MCP server | Sign in |
|---|---|---|
| `default` (no alias) | `x` | `/connect`, choose X, or `opencode mcp auth x` |
| `work` | `x-work` | `opencode mcp auth x-work` |
| `personal` | `x-personal` | `opencode mcp auth x-personal` |

`default` is the account with no alias, and its server is `x`. To use it, declare it in the map
(`{ "default": { "clientId": "…" } }`); a map with `work` and `personal` has no `default` account. With no `accounts`
option at all the plugin still has one `default` account, and its server cannot sign in until a profile names the app.

## The profile

| Field | Meaning |
|---|---|
| `clientId` | The OAuth 2.0 client id of the X developer app this alias signs in with. Required to register the server. |
| `clientSecretEnv` | The name of the environment variable that holds the app's client secret, for a confidential app. A native app uses PKCE and leaves it out. |
| `redirectUri` | The callback URL registered on the X app. Default: `http://127.0.0.1:8766/callback`. |

The profile is deliberately small: X needs nothing else per account. The alias chooses the account; the X handle is
whatever that account's OAuth sign-in is, and `probe` reports it.

X's OAuth scopes are pinned, because X's 401 names none: `tweet.read`, `users.read`, `follows.read`, `like.read`,
`block.read`, `list.read`, `list.write`, `space.read`, `broadcast.read`, `calls.read`, `bookmark.read`, `bookmark.write`,
`tweet.write`, `media.write` and `offline.access`. The plugin does not ask for a scope per call and never widens one.

## Picking an account

Pass `account: "<alias>"` on `probe` or `events_list`, as the tool's input or a script's argument. With one account it
may be left out; with two and no account the call is `ACCOUNT_REQUIRED`; an alias the plugin does not have is
`ACCOUNT_UNKNOWN`. `status` takes no account and lists every alias.

A cursor is bound to its plugin, feed and account. A cursor issued for `work` is refused for `personal` with
`CURSOR_INVALID`, and a cursor from one feed is refused by another.

## X's own tools per alias

X's pass-through tools are per alias too: `x-work_get_users_me` is the `work` server's tool and
`x-personal_get_users_me` is `personal`'s. A rule or grant for one alias never matches the other's tools. The plugin's
own methods resolve their account through the same alias; they never assume `default`.
