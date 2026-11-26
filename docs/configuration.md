# Configuration

The options and their defaults, generated from `capabilities.options`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do. |
| `accounts` | object | — | One profile per account alias; each alias signs in to its own X MCP server. |
| `maxCalls` | integer | `4` | The most X reads one events_list call makes, the account lookup included. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range. |
<!-- /generated:configuration -->

## Install

```sh
opencode plugin add github:we-the-rebel-alliance/x-plugin#v0.0.0
```

## One account

An X developer app is required: X's hosted MCP server has no dynamic client registration. In the app's User
authentication settings, add the callback URL (the default is `http://127.0.0.1:8766/callback`), then give the plugin
the app's OAuth 2.0 client id.

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/x-plugin#v0.0.0",
      "options": {
        "access": "ask-changes",
        "accounts": {
          "default": { "clientId": "your-x-app-client-id" }
        }
      }
    }
  ]
}
```

Sign in to the `x` server with `/connect` (choose X) or `opencode mcp auth x`. A confidential app keeps its secret in an environment
variable and names it with `clientSecretEnv`; a native app uses PKCE and leaves it out.

## Two accounts

One alias per X account, and one MCP server per alias:

```json
{
  "accounts": {
    "work": { "clientId": "your-work-app-client-id" },
    "personal": { "clientId": "your-personal-app-client-id", "clientSecretEnv": "X_PERSONAL_CLIENT_SECRET" }
  }
}
```

Sign in to `x-work` and `x-personal` separately. With two aliases a call that names no account is refused with
`ACCOUNT_REQUIRED`, whose next step lists them.

## Billed reads

`maxCalls` bounds the X reads one `events_list` call makes, the account lookup included; the default is 4. Each page
reports the counts it returned in `cost.units`, and the manifest declares the price of each unit. The plugin stops at
the page's limit; it never asks whether to spend.

## An untested host

`allowUntestedHost: true` starts the plugin outside `>=2.4.1 <2.5.0`. Leave it off unless a person accepts that the
tested behaviour does not apply.
