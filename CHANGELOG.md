# Changelog

One section per release. `0.0.0` is the first release in the new organization; the old history is not carried over.

## 0.0.0 (unreleased)

The repository's first release under `we-the-rebel-alliance`, rebuilt on the plugin standard:

- **OpenCode 2.4.1 only.** `@opencode/*` devDependencies are `2.4.1`, `opencode.host` is `>=2.4.1 <2.5.0`, and the
  only tested host is 2.4.1. The test matrices and code paths for older releases are gone; the host suite runs once,
  on 2.4.1, and its harness answers the 2.4 `server/discover` probe and waits for the background plugin load.
- **New name and repository.** The package is `@we-the-rebel-alliance/x-plugin`, version `0.0.0`. Every install line,
  badge, link and repository URL names the new organization and `blob/master`.
- **Fixed context.** The Code Mode namespace line is 320 characters and each skill description is within 300. The
  search window, the cost line, the "never ask whether to spend" rule, the public-post warning, the "only when asked"
  list and the sensitive-trait rule live in the two skill bodies. Nothing is pinned and there are no per-request hooks.
- **Three sources.** `x.mentions`, `x.bookmarks` and `x.timeline` remain. The app-only list snapshots
  `x.bookmarks.list` and `x.posts` are deleted, with their method fields, tests, docs and references.
- **Billed cost, no hook.** `x_events_list` and `probe` carry `cost.units` on every page, and the tests hold each
  answer to what X returned. The plugin no longer appends a cost line to model-path or Code Mode results: it registers
  no `execute.before`/`execute.after` hook. A script's result still carries the tools RPC's line, and the status Scripts
  row covers the script calls the plugin records.
- **A failed token rotation is visible.** When X refuses a refresh, the host reports the `x` server as `needs_auth`; the
  status RPC and `probe` answer `AUTH_REQUIRED`, with the redacted reason cut to 160 characters and the `/connect`
  next step. Several accounts and the literal `NEEDS_SIGN_IN` code come with the plugin contract.
- **No app-specific surface.** `docs/jelly.md`, the app-specific sections of the docs and the app-only reads are gone. The
  `jelly` and `sources` package keys, the copied kit scripts and the source-contract dependency stay until the plugin
  contract replaces them.
- **One CI job.** `.github/workflows/ci.yml` has a single `ci` job on Node 24 with read-only contents permission and
  actions pinned to commit SHAs.
