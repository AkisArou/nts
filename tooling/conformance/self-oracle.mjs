// A test that uses `node:<its own module>` as an oracle is comparing the module
// under test with itself.
//
//   node tooling/conformance/self-oracle.mjs
//
// The harness substitutes the implementation under test for **both** spellings,
// so inside a test `require("events")` and `require("node:events")` are one
// object. `events/test/prototype-surface-static.js` asserted that every name on
// node's `EventEmitter.prototype` was on ours, said in its own comment that it
// read node's class "at run time rather than listed", and compared node's
// prototype with itself. It passed for as long as it existed and could not have
// failed for the reason it was written.
//
// Requiring only the `node:` spelling is fine -- that is the module under test
// under another name. The fault is requiring **both** and treating one as
// node's, so that is what this looks for.
//
// The way to have an oracle in a test is a child `node -p`, which carries no
// harness hooks: what it prints is node's.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE_DIR = join(HERE, "../../runtime/node");

let scanned = 0;
const found = [];

for (const entry of readdirSync(NODE_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;
  const testDir = join(NODE_DIR, entry.name, "test");
  if (!existsSync(testDir)) continue;
  for (const file of readdirSync(testDir)) {
    if (!file.endsWith(".js")) continue;
    scanned++;
    const text = readFileSync(join(testDir, file), "utf8");
    const bare = new RegExp(`require\\("${entry.name}"\\)`).test(text);
    const prefixed = new RegExp(`require\\("node:${entry.name}"\\)`).test(text);
    if (!bare || !prefixed) continue;
    // A child process is the sanctioned way to hold both, and the `node:`
    // spelling then appears inside a string handed to `node -p` rather than in
    // a `require` this process runs. Checking for that is what keeps the fixed
    // files from being reported forever.
    const viaChild = /execFileSync|execSync|spawnSync/.test(text);
    found.push({ module: entry.name, file, viaChild });
  }
}

if (scanned === 0) {
  console.log("  INSTRUMENT FAILURE: no local test files were scanned at all.");
  console.log("  A clean result here would be a statement about the glob.");
  process.exit(2);
}

const suspect = found.filter((f) => !f.viaChild);
console.log(`  ${scanned} local test(s) scanned; ${found.length} hold both spellings; ` +
  `${suspect.length} without a child process`);
for (const f of suspect) {
  console.log(`  SELF-ORACLE  ${f.module}/${f.file}`);
  console.log("               requires both `x` and `node:x`, which the harness makes");
  console.log("               the same object. Read node's answer from a child `node -p`.");
}
for (const f of found.filter((x) => x.viaChild)) {
  console.log(`  ok (child)   ${f.module}/${f.file}`);
}
process.exitCode = suspect.length > 0 ? 1 : 0;
