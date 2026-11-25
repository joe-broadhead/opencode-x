# Changelog

## 0.0.0 (2026-11-25)

The first release of `@we-the-rebel-alliance/x-plugin`, on plugin-contract v0:

- **One manifest.** `capabilities` declares the plugin identity, the `mcp` accounts, the options, all 104 callables
  (three of the plugin's own and 101 pass-through X tools, classified by the inventory), the three events sources, no
  action and no bus event. `version` is `0.0.0`.
- **Accounts.** One vendor MCP server per alias, `x` for `default` and `x-work` for `work`; the profile names the X
  app's OAuth client id and, for a confidential app, the environment variable that holds its secret. A refused token
  refresh is the alias's `needs_sign_in`, with a redacted reason.
- **Three sources.** `x.mentions`, `x.bookmarks` and `x.timeline`, all events reads on one billed X service. Every page
  carries `cost.units` at X's published per-post, per-author and per-user rates; `probe` carries its one user unit.
  Cursors are bound to the plugin, feed and account.
- **Doors.** `register` wires every method as an agent tool, a Code Mode entry and an RPC method. X's tools are
  declared `mcp:<tool>` and owned by the vendor's server; the plugin registers no pass-through handler.
- **Fixed context.** The namespace line is 294 characters and each skill description is within 300. Nothing is pinned
  and there are no per-request hooks.
- **Kit.** `plugin-kit` runs conformance, generated docs and the forbidden scan; the plugin's own commands add
  typecheck, build, unit and pack. CI is one `ci` job and releases are cut from a tag.
- **Tests.** Unit tests for the handlers, the feed walk, the provider and the docs; a same-timestamp page-boundary test
  that proves both posts are listed exactly once; a conformance recording for two synthetic aliases; the kit's
  real-host T1 on OpenCode 2.4.1; and a pack test that builds, installs and starts the tarball.
