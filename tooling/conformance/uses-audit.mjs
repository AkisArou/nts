// Every `uses` file, against what its module actually imports.
//
//   node tooling/conformance/uses-audit.mjs
//
// A `uses` file names the other profile modules a module depends on. Nothing
// had read one back, and one of them was already right about a bug that took an
// afternoon to find: `dgram/uses` lists `net`, `dgram` calls
// `nts_net_default_auto_select_family`, and `build.sh` linked neither `net`'s C
// nor consulted this file. The addon compiled, linked, and failed at `require`.
//
// Two directions, and they mean different things:
//
//   undeclared   the module imports something its `uses` does not name. That is
//                the shape that cost the afternoon -- a dependency the build
//                cannot know about.
//   unimported   `uses` names something the module does not import directly.
//                Often legitimate: a transitive dependency, or one reached
//                through `internal`. Reported, not failed.
//
// Only the first is an error. Saying so is the point: a list that fails on its
// looser half stops being maintained.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE_DIR = join(HERE, "../../runtime/node");

const modules = readdirSync(NODE_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "node_modules")
  .map((e) => e.name);
const known = new Set(modules);

/** Which profile modules a module's TypeScript imports, at any depth. */
function imports(dir, into) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { imports(full, into); continue; }
    if (!entry.name.endsWith(".ts")) continue;
    const text = readFileSync(full, "utf8");
    for (const m of text.matchAll(/from\s+"(?:\.\.\/)+([a-z_]+)\//g)) {
      if (known.has(m[1])) into.add(m[1]);
    }
  }
  return into;
}

let checked = 0;
let undeclared = 0;
let unimported = 0;

for (const module of modules.sort()) {
  const path = join(NODE_DIR, module, "uses");
  const src = join(NODE_DIR, module, "src");
  if (!existsSync(path) || !existsSync(src)) continue;
  checked++;

  // An entry may name a subpath -- `stream/uses` says `zlib/iter` -- so the
  // module is the first segment. Reading the whole line as a module name
  // reported `zlib/iter` as declared-but-not-imported, which is a parsing
  // artefact wearing the shape of a finding.
  const declared = new Set(
    readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
      .map((l) => l.split("/")[0]),
  );
  const actual = imports(src, new Set());
  actual.delete(module);
  actual.delete("internal");

  const missing = [...actual].filter((m) => !declared.has(m)).sort();
  const extra = [...declared].filter((m) => !actual.has(m)).sort();
  if (missing.length > 0) {
    undeclared++;
    console.log(`  UNDECLARED  ${module}: imports ${missing.join(", ")} and does not declare it`);
  }
  if (extra.length > 0) {
    unimported++;
    console.log(`  declares    ${module}: ${extra.join(", ")} -- not imported directly (transitive?)`);
  }
}

console.log();
if (checked === 0) {
  console.log("  INSTRUMENT FAILURE: no `uses` file was read at all.");
  console.log("  A clean result would be a statement about the glob.");
  process.exit(2);
}
console.log(`  ${checked} module(s) with a \`uses\` file; ${undeclared} importing something ` +
  `undeclared, ${unimported} declaring something not imported directly`);
process.exitCode = undeclared > 0 ? 1 : 0;
