# Automations

An events source is read with a cursor in OpenCode automation state. The suggested cadence is a hint for the
automation, not a schedule the plugin sets, and an automation is the person's choice: the plugin never polls by itself.

<!-- generated:automations -->
| Source | Method | Provider floor | Suggested | Signals |
|---|---|---|---|---|
| `x.mentions` | `tools.x.events_list` | 1 min | 5 min | — |
| `x.bookmarks` | `tools.x.events_list` | 1 min | 10 min | — |
| `x.timeline` | `tools.x.events_list` | 1 min | 5 min | — |
<!-- /generated:automations -->

## A timer for one feed

Create one automation per alias and feed, with its own state. The call takes the feed's cursor from the automation's
state and answers a new one:

```js
const page = await tools.x.events_list({ source: "mentions", account: "work", cursor: state.mentions?.cursor })
```

Hand `page.events` to their destination, then keep `page.cursor` in that same state for the next run. Never rewrite the
cursor and never carry it between accounts or feeds.

The page is a nudge to read, not a delivery: events are `trust: "untrusted"`, so a destination renders them as data and
never follows their text. A page with `more: true` means another call now would list more; call again with the page's
own cursor. A cursor from one feed or account is refused with `CURSOR_INVALID`, so keep one state per feed and alias.

## Cadence

| Feed | Suggested | Why |
|---|---|---|
| `x.mentions` | 5 minutes | X's own rate limit for the read is about one call a minute per account. |
| `x.bookmarks` | 10 minutes | Bookmarks change only when the person saves something; the first listing is small. |
| `x.timeline` | 5 minutes | The busiest and dearest feed; leave it off an automation unless the person wants it. |

Every call is billed, and one call makes at most `maxCalls` reads (4 by default), the account lookup included. Each page
carries `cost.units`: price it from the manifest's published rates, and never quote an estimate as a charge.

`probe` is not needed before a read: `events_list` resolves the alias and names the signed-in owner on every page.
