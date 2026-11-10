// Fails when a forbidden API, legacy surface, private host reference or machine-local path appears
// in src/, test/, scripts/ or dist/. The list is the "Forbidden in this repository" list in AGENTS.md. APIs that the
// public @opencode/plugin 2.2.3 types already reject fail the typecheck instead. The family's internal working-folder
// path is refused in every git-tracked file, so a note in a doc or a skill is caught too.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { extname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const self = fileURLToPath(import.meta.url)
const ROOTS = ["src", "test", "scripts", "dist"]
const MEMBER = String.raw`\s*(?:\?\.|\.)\s*`
const PERMISSION_HOOK = new RegExp(String.raw`\bpermission${MEMBER}hook\b`)
/** The copy of the module shared by several plugins, and the bundle that inlines it. */
const TOOLS_RPC = ["src/host/tools-rpc.ts", "dist/index.js"]

const RULES = [
  { id: "fork-marker", pattern: /dispatch[-_ ]?lease|catalog[-_ ]?ownership|text[-_ ]?only[-_ ]?respons/i, why: "dispatch-lease, ownership and text-only markers are fork-only" },
  { id: "tool-options-mcp", pattern: new RegExp(String.raw`\boptions${MEMBER}mcp\b|\boptions\s*:\s*\{\s*mcp\s*:|\boptions\b[^\n;,]{0,80}\)${MEMBER}mcp\b`), why: "tool options.mcp delegation is fork-only" },
  { id: "plugin-image", pattern: new RegExp(String.raw`\bPlugin${MEMBER}image\b|\bPROFILE_IMAGE\b|profile[-_]?image|profile\.png`, "i"), why: "Plugin.image and profile images were dropped" },
  { id: "imported-oauth", pattern: /\bimported[-_]?(?:gh[-_]?)?oauth\b|\bimportedOAuth\b/i, why: "imported OAuth grants are not allowed" },
  { id: "v1-plugin-api", pattern: /@opencode-ai\//, why: "@opencode-ai/* is the V1 plugin API" },
  { id: "v1-hook", pattern: /["'`](?:tool\.execute\.(?:before|after)|chat\.(?:message|params)|permission\.ask)["'`]/, why: "V1 plugin hooks are not allowed" },
  { id: "generate-text", pattern: new RegExp(String.raw`\bgenerate${MEMBER}text\b`), why: "ctx.generate.text is deprecated" },
  { id: "experimental-policies", pattern: new RegExp(String.raw`\bexperimental${MEMBER}policies\b`), why: "experimental.policies is deprecated" },
  { id: "opencode-ai-import", pattern: /["'`]@opencode\/ai(?:\/[^"'`]*)?["'`]/, why: "@opencode/ai breaks between patch releases; import only @opencode/plugin" },
  // The tools RPC's evaluate hook only turns an ask on one of its own script calls in flight into a deny, because no one
  // can answer it. It is allowed there, and in the bundle that inlines it, exactly once (counted below).
  { id: "permission-hook", pattern: PERMISSION_HOOK, why: "no escalating permission hook; default rules go through ctx.agent.transform", except: TOOLS_RPC },
  { id: "internal-wording", pattern: /\bowner(?:'s)? (?:decision|ruling)\b|\bthe lead\b|\bhey-jelly #|\bG[1-4]\b|\blane\b/i, why: "shipped docs and comments state behaviour, not who decided it or which internal lane" },
  { id: "host-source", pattern: /packages\/(?:core|plugin|schema)\/src\b|opencode-[\w-]*-host\b|\bconsumer-host\b/, why: "never reference or import private host source or host checkouts" },
  { id: "absolute-path", pattern: /\/Users\/[^/\s"'`]+\/|\/home\/[^/\s"'`]+\/|\/(?:private\/)?var\/folders\/|(?<![\w.:/-])\/tmp\/|[A-Za-z]:\\\\?Users\\/, why: "machine-local home and temp paths do not belong in the repository; make temp folders with mkdtemp under realpathSync(\"/tmp\"), or use a relative path" },
]

// The family's working folders never reach a public file. This rule reads every git-tracked file, so a note in a doc,
// a skill or a fixture is caught as well as code. AGENTS.md and this script name the folder on purpose and are skipped.
const WORKING_FOLDER = /opencode-release\//
const WORKING_FOLDER_SKIP = new Set(["AGENTS.md", "scripts/check-forbidden.mjs"])

/** Every git-tracked path under the root. Outside a git checkout, such as a packed tarball, there are none to read. */
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean)
  } catch {
    return []
  }
}

/** Lines that name a working folder, in any tracked file. */
function workingFolderFindings() {
  const found = []
  for (const path of trackedFiles()) {
    if (WORKING_FOLDER_SKIP.has(path)) continue
    const file = join(root, path)
    if (!existsSync(file)) continue
    const buffer = readFileSync(file)
    if (buffer.includes(0)) continue
    buffer.toString("utf8").split(/\r?\n/).forEach((text, index) => {
      if (WORKING_FOLDER.test(text)) found.push({ path, line: index + 1, id: "working-folder", why: "the family's internal working folders must not appear in a public file", text })
    })
  }
  return found
}

const findings = []
for (const top of ROOTS) {
  const dir = join(root, top)
  if (!existsSync(dir)) continue
  for (const file of walk(dir)) {
    if (file === self) continue
    const path = relative(root, file).split(sep).join("/")
    if (top === "dist" && [".tsx", ".jsx"].includes(extname(file))) findings.push({ path, line: 0, id: "dist-jsx-source", why: "no .tsx or .jsx ships; the TUI is prebuilt" })
    const buffer = readFileSync(file)
    if (buffer.includes(0)) continue
    const lines = buffer.toString("utf8").split(/\r?\n/)
    if (TOOLS_RPC.includes(path)) {
      const hooks = lines.filter((text) => PERMISSION_HOOK.test(text)).length
      if (hooks !== 1) findings.push({ path, line: 0, id: "permission-hook", why: `the tools RPC must have exactly one permission hook, found ${hooks}` })
    }
    for (const rule of RULES) {
      if (rule.except?.includes(path)) continue
      lines.forEach((text, index) => {
        if (rule.pattern.test(text)) findings.push({ path, line: index + 1, id: rule.id, why: rule.why, text })
      })
    }
  }
}
findings.push(...workingFolderFindings())

for (const { path, line, id, why, text } of findings) {
  console.error(`${path}${line ? `:${line}` : ""}: [${id}] ${why}${text ? `\n    ${text.trim().slice(0, 160)}` : ""}`)
}
if (findings.length) {
  console.error(`\n${findings.length} forbidden reference(s) found. Remove them; see the forbidden list in AGENTS.md.`)
  process.exit(1)
}
console.log(`No forbidden references in ${ROOTS.filter((top) => existsSync(join(root, top))).join(", ")}.`)

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}
