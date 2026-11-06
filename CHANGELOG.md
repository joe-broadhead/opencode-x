# Changelog

All notable changes to this project are documented in this file. It follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.0] - Unreleased

### Added

- An OpenCode plugin over X's official MCP server, `https://api.x.com/mcp`, with the user's own X app as a static
  OAuth client: the client ID and secret from the plugin options or the `/connect` **X app** entry, the callback
  `http://127.0.0.1:8766/callback` and the scopes `tweet.read users.read bookmark.read bookmark.write tweet.write
  offline.access` pinned, and no client shipped.
- Default permission rules: the read tools run, every bookmark change, Article draft and Article publish asks, and a
  tool X adds later asks.
- `/x-status` and the `/x` status dialog, covering the connection, account, access, the app and its callback and
  scopes, the tools, agents without the default rules, the OpenCode check, and one next step.
- Two skills, `x` and `x-write`: searching and citing X posts, the cost of every call, your own timeline and
  bookmarks, personal data, untrusted and adversarial post text, and whom each change reaches.
- A tools RPC, `x.posts.tools`, that lets a script call the known reads with no model, as a session and its agent.
- A `jelly` declaration for X, with every known tool, both skills and the one sign-in.
- A drift check, `npm run drift`, against a saved X tool list.
