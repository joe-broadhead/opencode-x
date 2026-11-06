# Contributing

Read [AGENTS.md](AGENTS.md) first: it lists the rules for this repository and the APIs that must never appear in it.
[docs/architecture.md](docs/architecture.md) explains how the plugin works.

## Set up

You need Node.js 22.18 or later, npm, and [Bun](https://bun.sh). CI and the release use Node.js 24 and Bun 1.4.4,
the Bun inside stock OpenCode 2.2.3, 2.2.4 and 2.2.5.

```sh
npm ci --ignore-scripts
```

### Run your checkout in OpenCode

```sh
npm run build
```

Then list the folder in `plugins`, as an absolute path or a path relative to the config file that contains it, and
restart OpenCode. One entry loads both the server part and the terminal UI part. Run `npm run build` again after you
pull changes.

```json
{
  "plugins": ["/path/to/opencode-x"]
}
```

## Check

One command runs every check, in order, and stops at the first failure:

```sh
npm run check
```

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src/` and `test/`, strict, with unused names as errors |
| `unit` | `bun test ./test/unit`: every module in `src/`, the docs' counts and error table, and the Jelly declaration |
| `build` | `node scripts/build.mjs`: deletes `dist/` and bundles `src/index.ts` and `src/tui.ts` with esbuild into the self-contained `dist/index.js` and `dist/tui.js`. Fails if a bundle imports anything the host does not provide |
| `host` | `bun test ./test/host`: the plugin inside an embedded OpenCode host, once on each tested release (`@opencode/sdk` 2.2.3, 2.2.4 and 2.2.5) |
| `pack` | `bun test ./test/pack`: builds, packs and installs the package, imports both entry points, and loads it in stock OpenCode 2.2.3, 2.2.4 and 2.2.5 |
| `forbidden` | `node scripts/check-forbidden.mjs`: scans `src/`, `test/`, `scripts/` and `dist/` for forbidden APIs and machine-local paths |
| `whitelist` | Checks `package.json` against the approved package shape, and that `dist/` holds exactly `index.js` and `tui.js` |

To run some stages only, name them; they run in the order given:

```sh
node scripts/check.mjs typecheck unit
```

Shortcuts: `npm run typecheck`, `npm run build`, `npm test` (the `unit` stage), `npm run test:host`,
`npm run test:pack` and `npm run lint` (the `forbidden` stage).

`TESTED_HOSTS` in `src/constants.ts` is the one list of tested OpenCode releases: 2.2.3, 2.2.4 and 2.2.5. The host
and pack stages, status and CI all take their versions from it. Add a release there, and to the README's
requirements, when every check passes on it.

The host stage starts an embedded OpenCode host in a temporary home folder, with a local fake of X's MCP server and
sign-in server, once for each tested release. A request to any address other than the local machine fails the test.
2.2.3 is the locked `@opencode/sdk`; the stage installs the others from npm, outside this repository's lockfile, into a
temporary folder that it deletes afterwards (about 370 MB each, from npm's cache after the first run). To run the host
stage on one other OpenCode 2.2.x only, install that SDK in a separate folder and point `HOST_SDK_DIR` at it:

```sh
mkdir ../sdk-2.2.6 && cd ../sdk-2.2.6 && npm init -y && npm install @opencode/sdk@2.2.6 --ignore-scripts && cd -
HOST_SDK_DIR=../sdk-2.2.6 node scripts/check.mjs host
```

Every temporary folder of the host and pack stages is a git repository under the system's `/tmp`, never under
`TMPDIR` or your home folder. OpenCode looks for `.opencode` folders and project config upwards from a project, and
stops at a repository's root, so it never picks up your own agents or skills. Each stock server listens on its own
free port. The sign-in tests use the pinned callback port 8766, one at a time.

The pack stage needs network access to the npm registry. It checks that the tarball contains exactly the `files`
whitelist, with fewer than 30 entries and at most 100 KB; that `dist/` holds only `index.js` and `tui.js`, with no
relative import, dynamic `import()` or `require()`; and that they import only modules OpenCode provides. It installs
the tarball next to the host packages that OpenCode 2.2.3 provides and imports both entry points under Bun. Then it
installs the tarball alone and loads it with `opencode serve` from stock OpenCode 2.2.3, 2.2.4 and 2.2.5, with a
project that gives the plugin an X app client ID and secret. Each server runs offline, in its own temporary home, on
its own port with a password. The stage checks that every path in `opencode debug paths` is inside that home, that the
plugin is active, that the `x` server and the default rules are registered, that `/connect` lists the server as "X",
and that the status RPC answers. It then points a copy of the installed plugin at a local fake of X, calls the tools
RPC as a script would, and completes the fixed-client sign-in against the fake's sign-in server.

To use `opencode` binaries you already have, set `OPENCODE_BIN_2_2_3`, `OPENCODE_BIN_2_2_4` and `OPENCODE_BIN_2_2_5`:

```sh
OPENCODE_BIN_2_2_3=/path/to/opencode-2.2.3 OPENCODE_BIN_2_2_4=/path/to/opencode-2.2.4 \
  OPENCODE_BIN_2_2_5=/path/to/opencode-2.2.5 node scripts/check.mjs pack
```

Otherwise the stage installs `@opencode/cli` with the binary for your platform (macOS or Linux, arm64 or x64), a few
hundred megabytes per version, once per run, into a temporary folder that it deletes afterwards.

CI (`.github/workflows/ci.yml`) runs `npm ci --ignore-scripts` and `npm run check` on Linux and macOS.

**No check calls X or reads a real credential.** The fakes exist for that. Never run `opencode mcp auth x` from a
check, and never save a token, a client secret or X content in this repository.

## X's tools

`src/x-tools.ts` is the one record of the X tools the plugin knows: `READ_TOOLS` run without a prompt and are the
tools RPC's methods, `WRITE_TOOLS` are private writes that ask, `PUBLIC_TOOLS` reach other people and ask, `DENY_TOOLS`
are off, and `PARAMETERS` holds each tool's input parameters. The default rules, the tools RPC, status's unknown and
denied tools, the fake server in the host and pack tests, and the checks of `jelly.tools`, the docs and the skills all
derive from it. X's hosted server is closed and unversioned, and may add, rename or remove tools without notice. It may
also list fewer tools for a token with fewer scopes, so a known tool missing from one list is not drift.

The names and classes are **provisional**. X answers `tools/list` only for a signed-in token, and no live list is
recorded here yet: the names come from X's MCP capability table, a third party's recorded list (24 read and bookmark
names) and X's OpenAPI operation ids, which the hosted server names its tools after. `test/unit/x-tools.json` records
that table, with names only: X publishes no MCP schemas or annotations, so `PARAMETERS` is empty and the skills name
tools without their inputs. In Code Mode each call's signature gives the model the parameter names. Once a tool list
from a signed-in server is saved, reconciling is a data change, made with the drift check below.

### Drift check

The drift check is a manual maintainer check. It is not part of `npm run check` or CI, nothing at runtime depends on
it, and it never calls X or reads a credential. Save the tool list first, by either of these:

- in an OpenCode project signed in to X with the app's scopes, a throwaway local plugin that writes
  `ctx.tool.list()`'s `x` tools (`name`, `description`, `inputSchema`) as `{ "tools": [...] }` to a file;
- an MCP client's `tools/list` result for `https://api.x.com/mcp`, saved as JSON, which also carries X's annotations.

A list in the research form, `{ "tools": [{ "name", "annotations", "inputs": ["name*:type", …] }] }`, works too, and
`annotations` and `inputs` may be missing, as in `test/unit/x-tools.json`. Keep a saved list out of this repository,
except as that fixture, which lists names and input schemas only. Then:

```sh
npm run drift -- <tools.json>
npm run drift -- <tools.json> --strict
```

- It needs Node.js 22.18 or later, which loads `src/x-tools.ts` by stripping its types. Keep that file free of
  runtime imports.
- It prints only tool names, parameter names and types, and annotations, grouped as added (listed, but in no list),
  removed (in a list, but not in the file; information only, since scopes differ), possibly renamed (a removed and an
  added tool that take mostly the same parameters), parameters changed (added, removed, now required or optional, or a
  new type), parameters to record (the file gives a known tool's input, which `PARAMETERS` doesn't have yet), change
  wording (a known read's description has a sentence in which the tool itself creates, changes or sends something),
  and, when the file has annotations, reclassified (the lists disagree with `readOnlyHint` or `destructiveHint`).
- What it can't see: OpenCode's tool list carries no annotations, so a tool that starts changing data shows only if
  its description says so. Read each new or changed description yourself.
- Exit codes: `0` for no drift, or drift without `--strict`; `1` for drift with `--strict`; `2` for a usage or file
  error.

`test/unit/x-tools.json` records the list the plugin was built from, and the drift test runs the check on it with
`--strict`, so `src/x-tools.ts` must match it exactly. Replace that file with a newly saved list (the same fields, and
a `source` line with no local path) when X changes its tools.

### Updating the tool lists

1. Run the drift check.
2. For each name it reports, read the tool's description, schema and annotations, and check what it does.
3. Add a tool to `READ_TOOLS` only if it never changes anything and sends nothing beyond its query, because reads run
   without a prompt and each one is also a method of the tools RPC for scripts. Add a tool that changes only the
   user's own account and reaches nobody to `WRITE_TOOLS`. Add a tool that posts, replies, quotes, reposts, publishes,
   mentions or messages anyone to `PUBLIC_TOOLS`. Add a tool that sends a DM, follows or unfollows, blocks or mutes,
   deletes a post, changes list membership, changes account or profile settings, or sends data to X's team to
   `DENY_TOOLS`. Leave a tool out if you are not sure: it then asks before every call, and scripts cannot call it.
4. Update `PARAMETERS` from the schemas, `jelly.tools` in `package.json`, and any skill text that names a changed tool.
   With parameters recorded, a skill may give a literal call such as `search_posts_all({ … })`, and the skills test
   checks its keys against `PARAMETERS`. Run `npm run check`: the Jelly test fails if `jelly.tools` differs from the
   lists, the skills test if a skill names a tool or parameter the record doesn't have, and the docs test if a doc
   names a tool in no list.
5. Record the change in `CHANGELOG.md`. Moving a tool between the lists changes the default rules and the tools RPC's
   methods, which are part of the plugin's contract.

## Commits

Use `type(scope): summary`, for example `fix(status): explain a disabled server`. Keep commits small, and keep
`npm run check` green.

## Releases

### Versioning

The version follows semantic versioning on the plugin's contract: its options, the `/x-status` command, the `/x`
dialog, the skill names, the server name `x` and its URL, the status RPC method, the tools RPC's methods and the
default rule behaviour. While the major version is 0, a breaking change raises the minor version, and anything else
the patch version.

Each release supports one tested OpenCode line, stated as `opencode.host` in `package.json` and enforced by the host
check (`SUPPORTED_HOST` in `src/constants.ts`). Both must change together, with the README's requirements. Each
`CHANGELOG.md` entry follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### Releasing

1. Update `version` in `package.json` and add the `CHANGELOG.md` entry, then run `npm run check`.
2. Push the release commit to `master` and tag it `v<version>`. The release workflow refuses a private package or a
   tag that differs from `version`.
3. Approve the run in the GitHub environment `release`.

CI then runs `npm run check`, packs the tree, runs the pack test against that exact tarball
(`PACK_TARBALL=<tarball> node scripts/check.mjs pack`), and publishes it with npm trusted publishing and provenance:
`npm publish <tarball> --provenance --access public`. The trusted publisher on npmjs.com names this repository, the
workflow `release.yml` and the environment `release`, and allows `npm publish`. A rerun skips a version that is
already on npm.

### Dist-tags

- `latest`: the newest stable release. The release workflow sets it for versions without a prerelease part.
- `next`: prereleases, such as `<version>-rc.1`. The release workflow sets it.
- `host-2.2`: the newest release for OpenCode 2.2.x. Move it by hand, so users on 2.2 can still install a matching
  version after `latest` moves to a newer OpenCode line:

  ```sh
  npm dist-tag add @joe-broadhead/opencode-x@<version> host-2.2
  ```

Never unpublish a release. Deprecate it instead, and name the version to use:

```sh
npm deprecate @joe-broadhead/opencode-x@<version> "<reason>. Use <version> instead."
```
