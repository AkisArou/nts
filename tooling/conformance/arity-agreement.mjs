// Does a published function's `length` agree with the arity it demands?
//
//   NTS_ADDON_OUT=<a private directory> node tooling/conformance/arity-agreement.mjs
//   NTS_ADDON_OUT=<...> node tooling/conformance/arity-agreement.mjs async_hooks fs
//
// The publication producer records exposed and demanded arity in the manifest
// beside addon.c. The reader validates its version, complete inventory and glue
// binding before comparing them. A missing or edited record is an instrument
// failure, including for a module that legitimately publishes no functions.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readArityRows } from "./addon-manifest.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node");

const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modules = argv.length > 0
  ? argv
  : readdirSync(join(ROOT, "runtime/node"))
    .filter((m) => m !== "node_modules" && existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
    .sort();

let checkedModules = 0;
let functions = 0;
let disagreeing = 0;
const publishesNoFunctions = [];

for (const module of modules) {
  const rows = readArityRows(join(ADDON_DIR, `${module}.build`));
  if (rows.length === 0) {
    publishesNoFunctions.push(module);
    continue;
  }
  checkedModules += 1;
  functions += rows.length;
  const bad = rows.filter((r) => r.demands !== null && r.demands > r.length);
  disagreeing += bad.length;
  if (bad.length === 0) continue;
  console.log(`  ${module}: ${rows.length} published function(s), ${bad.length} disagreeing`);
  for (const row of bad) {
    console.log(`      ARITY  ${row.name}  length ${row.length}, demands ${row.demands}`);
  }
}

if (publishesNoFunctions.length > 0) {
  console.log(`  ${publishesNoFunctions.length} module(s) publish no function at all: ` +
    `${publishesNoFunctions.join(", ")}.`);
  console.log("  Nothing to disagree about, which is a fact about those modules and not a pass.");
}

console.log(
  `\n  ${functions} published function(s) across ${checkedModules} module(s), ` +
  `${disagreeing} whose length disagrees with the arity they demand.`,
);
console.log("  A disagreement is the one case where a caller doing exactly what the");
console.log("  function's own `length` says still fails. Read from the producer manifest, so");
console.log("  it covers the modules that cannot be called.");
