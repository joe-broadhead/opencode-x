// The installed package's own facts: the manifest the kit validates, and the version status reports.
//
// The manifest is read from `package.json` beside `dist/`, so a person's installed package and the conformance kit
// read the same file. Nothing here parses it again: `manifest` is the `capabilities` value, and `readInstalledManifest`
// in the contract is the one validator.
import { readFileSync } from "node:fs"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"

interface PackageFile {
  readonly name: string
  readonly version: string
  readonly capabilities: Manifest
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageFile

/** The plugin's `capabilities` manifest, as the installed package carries it. */
export const manifest: Manifest = pkg.capabilities
/** The installed package's version, which status reports and the release tag matches. */
export const VERSION: string = pkg.version
/** The package's name, which a page names as its plugin. */
export const PACKAGE: string = pkg.name
