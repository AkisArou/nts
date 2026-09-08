// Every `uses` file, against what its module actually imports.
//
//   node tooling/conformance/uses-audit.mjs
//
// **A `uses` file is a substitution list, not a dependency declaration**, and
// the first version of this audit was built on the second reading.
//
// `run-one.mjs` reads it and, for each entry, replaces node's implementation of
// that module with **ours** when a test requires it. So a module a `uses` file
// does *not* name is a deliberate choice: the test keeps node's real
// implementation as a stable dependency, and only the subject is under test.
//
// Reading it as a dependency list, this reported that eight of thirteen modules
// "import something they do not declare" and I added the missing names. That
// substituted our `util` into `http`'s tests and our `os` into `process`'s, and
// **ten tests that had passed began to fail** -- `http` 404 to 398, `process`
// 87 to 85. Reverted. The lists were right and the reading was wrong.
//
// So the finding this file can honestly report is much narrower: an entry that
// names a module or subpath which does not exist. That entry substitutes
// nothing and hides that it substitutes nothing, which is the shape this
// directory keeps finding. The relationship between a `uses` file and the
// module's imports is **not** a thing to check: they answer different
// questions.

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

  void actual;
  // The only check that means anything: does the entry name something that
  // exists? An entry naming a module the profile does not have substitutes
  // nothing, and a test that expected our implementation quietly gets node's.
  const raw = readFileSync(path, "utf8").split("\n").map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
  for (const entry of raw) {
    const name = entry.split("/")[0];
    if (!known.has(name)) {
      undeclared++;
      console.log(`  NO SUCH MODULE  ${module}/uses names \`${entry}\`, which is not a module here`);
      continue;
    }
    if (!existsSync(join(NODE_DIR, name, "src"))) {
      undeclared++;
      console.log(`  NO SOURCE       ${module}/uses names \`${entry}\`, which has no src/`);
    }
  }
}

console.log();
if (checked === 0) {
  console.log("  INSTRUMENT FAILURE: no `uses` file was read at all.");
  console.log("  A clean result would be a statement about the glob.");
  process.exit(2);
}
void unimported;
console.log(`  ${checked} module(s) with a \`uses\` file; ${undeclared} entr(ies) naming ` +
  `something that does not exist`);
console.log("  A `uses` entry substitutes our implementation for node's in that");
console.log("  module's tests. What it does NOT name is deliberate, so this does");
console.log("  not compare the list against the module's imports.");
process.exitCode = undeclared > 0 ? 1 : 0;
