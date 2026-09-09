// Every `not-applicable` entry, checked against the suite it names.
//
//   node tooling/conformance/skip-audit.mjs
//
// A skip is a file removed from a denominator, so every percentage in the
// ledger is computed without it. The entries carry a reason each and are read
// by a person when they are written; nothing has ever read them back.
//
// Three ways an entry can be wrong, and only the first is visible today:
//
//   no reason      the line is a bare filename, so the skip is unjustified
//   stale          it names a file the pinned suite does not have, so it
//                  excludes nothing and hides that it excludes nothing
//   unclaimed      it names a file the module's own pattern never matches, so
//                  the skip is inert for a different reason
//
// The middle one is the dangerous shape this repository keeps finding: an entry
// that excludes nothing looks exactly like an entry that excludes something,
// and the count of "not applicable" is quoted as though every line earned its
// place.
//
// **Both checks were controlled on 2026-09-09** rather than trusted for
// answering zero. An entry appended with no reason reported `1 without a
// reason`; an entry whose reason named a file the suite does not have reported
// `1 naming a file the suite does not have`. The tree was restored after each.
//
// A `0 without a reason` from a check that has never been seen to find one is a
// claim about the skip lists rather than a measurement of them, and this file
// exists precisely because a skip nobody justified is invisible.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
// Every suite, not just `parallel`. The first version of this checked
// `test/parallel` alone and reported **61 stale entries**; the modules name
// files in `client-proxy`, `pseudo-tty` and others, and an entry may carry a
// directory prefix of its own. Sixty-one wrong findings, each shaped exactly
// like a real one, from an instrument that assumed the shape of what it was
// measuring. That is the fault this directory keeps producing, and this is the
// second time today it produced it in a tool written to check for it.
const SUITE_ROOT = join(ROOT, "third_party/node/test");
const NODE_DIR = join(ROOT, "runtime/node");

if (!existsSync(SUITE_ROOT)) {
  console.log("  INSTRUMENT FAILURE: no pinned suite at third_party/node/test.");
  console.log("  Every entry would read as stale, which is a statement about this");
  console.log("  machine rather than about the skip lists.");
  process.exit(2);
}

/** Every test file name under `third_party/node/test`, at any depth. */
function everyTestFile(dir, into) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "fixtures" || entry.name === "node_modules") continue;
    if (entry.isDirectory()) { everyTestFile(join(dir, entry.name), into); continue; }
    into.add(entry.name);
  }
  return into;
}
const suite = everyTestFile(SUITE_ROOT, new Set());
let entries = 0;
let noReason = 0;
let stale = 0;
const problems = [];

for (const entry of readdirSync(NODE_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;
  const path = join(NODE_DIR, entry.name, "not-applicable");
  if (!existsSync(path)) continue;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    entries++;
    const at = line.indexOf(":");
    const file = at < 0 ? line : line.slice(0, at).trim();
    const reason = at < 0 ? "" : line.slice(at + 1).trim();
    if (reason === "") {
      noReason++;
      problems.push(`  NO REASON   ${entry.name}/${file}`);
      continue;
    }
    // A local file is this profile's own and is not in node's suite.
    if (file.startsWith("local/")) continue;
    // An entry may carry a directory of its own -- `pseudo-tty/test-x.js` --
    // and the suite is indexed by basename, so compare the last segment.
    const basename = file.slice(file.lastIndexOf("/") + 1);
    if (!suite.has(basename)) {
      stale++;
      problems.push(`  STALE       ${entry.name}/${file}  -- not in the pinned suite`);
    }
  }
}

if (entries === 0) {
  console.log("  INSTRUMENT FAILURE: no not-applicable entries were read at all.");
  console.log("  A clean result here would be a statement about the glob.");
  process.exit(2);
}

for (const problem of problems) console.log(problem);
console.log();
console.log(`  ${entries} entr(ies) across the profile; ${noReason} without a reason, ` +
  `${stale} naming a file the suite does not have`);
process.exitCode = problems.length > 0 ? 1 : 0;
