// Names a compiled addon publishes that node does not have, and whether the shim
// lets any of them reach a test.
//
//   node tooling/conformance/addon-extras.mjs <dir-of-built-addons>
//   node tooling/conformance/addon-extras.mjs <dir-of-built-addons> --control
//
// # Why this is its own question
//
// `http`'s addon publishes `methods` and `getHTTPParserPoolLimit`, and node has
// neither. Publishing an internal node lacks is the thing the per-module
// `export-surface-static.js` tests exist for, and on the compiled side nothing was
// asking it: the surface instruments compare the *interpreted* profile against
// node, and the addon is a third surface neither of them loads.
//
// Two questions, not one, and the second is the one that decides whether it
// matters:
//
//   published by the addon and absent from node   28 names across 7 modules
//   of those, reaching a shaped surface            0
//
// The shim filters every one. That is not luck -- `shape()` builds the module
// object it hands a test from named parts, and an unrecognised export simply is
// not among them -- but it had never been checked, and "the shim probably handles
// it" is not a measurement.
//
// # `--control`, because a zero from a check that has never reported anything is
// # a claim
//
// The control inverts the node test: it asks the same shaping question about the
// names node **does** have. All 73 of them survive, across every module that
// publishes anything. So the path from "the addon publishes X" to "a test can see
// X" is live and this file can see it, which is what makes the 0 above a result.
//
// It also re-derives the 73 independently, which is the count of node's 505
// published names that the compiled lane provides.

import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const require_ = createRequire(import.meta.url);
const dir = process.argv[2];
if (dir === undefined || !existsSync(dir)) {
  console.error("usage: addon-extras.mjs <dir-of-built-addons> [--control]");
  process.exit(2);
}
const CONTROL = process.argv.includes("--control");

let reaching = 0;
let filtered = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".node")).sort()) {
  const moduleName = basename(file, ".node");
  let addon;
  let upstream;
  try {
    addon = require_(resolve(join(dir, file)));
    upstream = require_(`node:${moduleName}`);
  } catch (error) {
    console.log(`  ${moduleName.padEnd(18)} not compared -- ${error?.message ?? error}`);
    continue;
  }

  const subject = Object.keys(addon).filter((k) => (CONTROL ? k in upstream : !(k in upstream)));
  if (subject.length === 0) continue;

  const shapePath = `runtime/node/${moduleName}/shape.mjs`;
  if (!existsSync(shapePath)) {
    console.log(`  ${moduleName.padEnd(18)} ${subject.length} name(s), no shape.mjs to ask`);
    continue;
  }
  let shaped;
  try {
    const shim = await import(resolve(shapePath));
    // A copy, because `shape()` deletes from what it is handed.
    shaped = shim.shape({ ...addon });
  } catch (error) {
    console.log(`  ${moduleName.padEnd(18)} ${subject.length} name(s), shape() threw: ${String(error?.message).slice(0, 48)}`);
    continue;
  }

  const survives = subject.filter((k) => k in Object(shaped));
  reaching += survives.length;
  filtered += subject.length - survives.length;
  const tail = survives.length > 0 ? `: ${survives.join(", ")}` : "";
  console.log(`  ${moduleName.padEnd(18)} ${String(subject.length).padStart(2)} ${CONTROL ? "of node's" : "extra"}, ${String(survives.length).padStart(2)} reach a test${tail}`);
}

const what = CONTROL ? "node's own names" : "names absent from node";
console.log(`\n  ${what}: ${reaching} reach a shaped surface, ${filtered} filtered by the shim`);
