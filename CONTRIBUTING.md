# Contributing

The plugin follows the [plugin standard](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/plugin-standard.md)
and the [contract](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/contract.md). Read
`AGENTS.md` first; it is the short version for this repository.

## Before a pull request

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` bundles `dist/index.js`, typechecks, runs the unit, conformance-recording and pack tests, then runs
`npx plugin-kit check` (conformance on the real 2.4.1 host, generated docs, forbidden patterns and the bundled-kit
check). A change to the manifest needs `npx plugin-kit docs` in the same commit.

`dist/` is committed. A change under `src/` needs `npm run bundle` and the resulting `dist/index.js` in the same
commit; `npm run check` and CI fail when the committed bundle is stale.

Never skip a test to get a green run: fix it, or delete it with the reason in the pull request.

## A change to a method or source

1. Change `capabilities` in `package.json` first: the method's class, operations, accounts, cost and `effect`.
2. Add or update its handler in `src/handlers/`, and the provider call in `src/provider/`.
3. Unit-test the handler and the provider mapping, then record the fixture:
   `RECORD=1 bun test ./test/conformance && npx plugin-kit record --account work`.
4. Run `npx plugin-kit docs` and `npm run check`.
5. Describe the observable change in the skill only when agents need it.

## Install paths

Published installs use a release tag only:

```sh
opencode plugin add github:we-the-rebel-alliance/x-plugin#v0.0.0
```

During development, point a local OpenCode configuration at the checkout instead:

```json
{ "plugins": ["/path/to/x-plugin"] }
```

That is a developer checkout, not an install path; do not document it as one.

## Commits

Conventional commits; one pull request per concern. Every commit is authored by the lane's operator and committed
through GitHub, so the org's verified-signature rule holds. Never push to `master`, and never merge your own pull
request.

## Releasing

The owner cuts a release, not a contributor and not an agent. `npx plugin-kit release <version>` only prepares and
checks a local tag; a GitHub tag and Release are cut after review, with the tarball and its `SHA256SUMS` attached. The
first release in this organization is `v0.0.0`.
