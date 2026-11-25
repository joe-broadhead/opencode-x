# Architecture

Four layers, each with one job:

| Layer | Files | Job |
|---|---|---|
| Server entry | `src/index.ts` | `assertHost`, the accounts plan, `registerAccounts`, the handler table, one `register` call |
| Handlers | `src/handlers/` | `status`, `probe`, `events_list`, the feed walk and the cursor state; no door code |
| Provider | `src/provider/` | X's endpoint, scopes and tool names; the host executor per alias; X's answer parsing; failures |
| Accounts | `src/accounts.ts` | the profile schema's values, the MCP server config per alias, the per-alias observations status reads |

`src/manifest.ts` reads `package.json` beside the bundle, so the installed manifest and the kit read one file.

## The bundle

`dist/index.js` is one esbuild bundle. `@opencode/*` and Node built-ins stay external; the contract's `register`,
`accounts`, `events`, `cursor` and `manifest` modules are bundled in, so the installed package needs no runtime
dependency. `dist/` is built by `npm run build` and is not committed.

## Reading X

X's hosted MCP server holds the account's OAuth credential. OpenCode registers one MCP server per alias (`x`, `x-work`,
…), and each of the vendor's tools has the effective name `<server>_<tool>`. The provider asks `ctx.tool.list()` for
that name and runs the executor with the caller's context, so the session's own permission rules apply and the plugin
never holds a token. `ctx.mcp.list()` gives the per-alias server state that `status` reads; it is never used to choose
a tool.

One `events_list` call makes at most `maxCalls` X reads, the account lookup included:

1. `get_users_me` names the signed-in owner and the alias's X id (one billed user read).
2. When the cursor has a post, one small `get_users_<feed>` read checks X still lists a post at or before it; when it
   does not, the page carries `gap` with `reason: "expired"`.
3. `get_users_mentions`, `get_users_bookmarks` or `get_users_timeline` fill the page, newest first, until the page's
   limit or the read budget is reached.

Mentions and the timeline are read by `since_id` (or `start_time` on a first listing); bookmarks have no `since_id`, so
the cursor keeps the newest known bookmark ids and the walk stops at the first one it meets. A window the call cannot
finish is narrowed for the next call rather than skipped: the cursor holds the feed's `since_id`, the window's cap and
the newest listed time. A bookmarks walk the cap stops stores X's page token and resumes there.

Pages are normalised by the contract: `makeEvent` for each post, `screenEvents` to refuse a post holding a secret,
`fitPage` for the size and limit, `eventsListResult` for the page. The cursor is `encodeBoundCursor` over
`(plugin, feed, account)`.

## What is kept between calls

Nothing about content. The plugin keeps, in memory for one plugin instance:

- the last owner each alias's probe or page answered, so `status` can name it without another billed read;
- the last provider failure per alias, so a refused refresh is `needs_sign_in` until a read succeeds;
- the accounts registration's problems, which `status` reports.

There is no cache of posts, no database and no file. A cursor is the consumer's, not the plugin's.

## OpenCode APIs used

`Plugin.define`, `ctx.app.version` (`assertHost`), `ctx.options`, `ctx.integration`/`ctx.mcp.transform` (through
`registerAccounts`), `ctx.tool.list()` and an executor's `execute`, `ctx.mcp.list()`, `ctx.agent.transform` and
`ctx.permission.assert` (through `register`), `ctx.rpc.register` (through `register`), and the tool context's `signal`.
No private or experimental OpenCode module is imported.

## Adding a method

Declare it in `package.json` `capabilities.methods` with its class, operations and accounts, put its handler in
`src/handlers/`, add it to `src/handlers/index.ts`, then run `npx plugin-kit docs` and `npm run check`. A pass-through
vendor tool is declared `mcp:<tool>` and has no handler.
