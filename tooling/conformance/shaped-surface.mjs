// What a module actually publishes on the compiled lane, after `shape.mjs`.
//
//   node tooling/conformance/shaped-surface.mjs <addon-dir> [module ...]
//
// # Why a key count is a lane-level check
//
// A `shape.mjs` reads `exports.default` and several modules' addons do not export
// one, so `shape` takes its blank-module branch and the lane publishes `{}`. That is
// not a failure anywhere: the addon loads, the shape runs, every test runs, and the
// ones that select their own subject --
//
//     if (cluster.isWorker) { ... } else if (cluster.isPrimary) { ... }
//
// -- take neither branch and pass having asserted nothing. `cluster` read **25
// passed** on the compiled lane that way, which is the whole of its compiled row,
// and the number went into a ledger and a goal file before anybody asked what
// `require('cluster')` returned there. Its own `shape.mjs` documents this exact
// hollowness for `--sabotage` and the compiled lane reproduced it for free.
//
// So: 0 keys is not a small surface, it is no surface, and a row above 0 passes
// beside it is a row about nothing.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

const req = createRequire(join(process.cwd(), "x.js"));
const addons = process.argv[2];
if (addons === undefined) {
  console.error("usage: shaped-surface.mjs <addon-dir> [module ...]");
  process.exit(2);
}
const root = join(import.meta.dirname, "../..");
let names = process.argv.slice(3);
if (names.length === 0) {
  const { readdirSync } = await import("node:fs");
  names = readdirSync(join(root, "runtime/node")).filter((m) =>
    existsSync(join(root, "runtime/node", m, "tsconfig.json")));
}

let empty = 0;
for (const m of names) {
  const addon = join(addons, `${m}.node`);
  if (!existsSync(addon)) { console.log(`  ${m.padEnd(20)} no addon`); continue; }
  let raw;
  try { raw = req(addon); } catch { console.log(`  ${m.padEnd(20)} WILL NOT LOAD`); continue; }
  const shapePath = join(root, "runtime/node", m, "shape.mjs");
  let keys;
  if (existsSync(shapePath)) {
    try {
      const { shape } = await import(shapePath);
      keys = Object.keys(shape(raw) ?? {}).length;
    } catch (error) {
      console.log(`  ${m.padEnd(20)} shape threw: ${error.message.slice(0, 48)}`);
      continue;
    }
  } else {
    keys = Object.keys(raw).length;
  }
  if (keys === 0) empty += 1;
  console.log(`  ${m.padEnd(20)} ${String(keys).padEnd(6)} ${keys === 0 ? "PUBLISHES NOTHING" : ""}`);
}
console.log(`\n  ${empty} module(s) publish nothing on this lane.`);
process.exit(empty === 0 ? 0 : 1);
