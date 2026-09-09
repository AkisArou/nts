// Every published value, differenced against node's, through the shim.
//
//   node tooling/conformance/surface-diff.mjs
//   NTS_ADDON_OUT=<a private build> node tooling/conformance/surface-diff.mjs
//
// `hidden-exports.mjs` asks whether a name reaches a test. This asks whether
// the value behind it is node's. They are different questions and a name can
// pass the first and fail this one.
//
// # Through the shim, not the raw addon
//
// The addon's `zlib.constants` carries a `codes` key because `constants.ts`
// exports both and the addon publishes the module; `shape.mjs` builds the
// public `constants` from an explicit list and puts `codes` beside it, which is
// node's shape. Reading the artifact would have reported a defect that the
// module does not have -- it did, and this file exists partly to stop the next
// one.
//
// **Which question is being asked decides the layer.** "Does the addon compute
// it" wants the raw `.node`; "does a test see node's value" wants the module.
// This is the second.
//
// # What is compared, and what is not
//
// Scalars and two levels of plain-object table. Functions are compared only by
// their presence, because calling them is `unusable-exports.mjs`'s job and
// calling them here would arm timers and open handles.
//
// A value node has and this profile does not is reported as `missing`; a value
// both have and they disagree on is `differs`, which is the interesting column.
// `extra` is reported last and is usually the profile's own internals.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node");
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modules = argv.length > 0
  ? argv
  : readdirSync(join(ROOT, "runtime/node"))
    .filter((m) => m !== "node_modules" && existsSync(join(ADDON_DIR, m + ".node")))
    .sort();

let totalDiffer = 0, totalMissing = 0, checked = 0;

for (const module of modules) {
  const m = { exports: {} };
  try {
    process.dlopen(m, join(ADDON_DIR, module + ".node"),
      require("node:os").constants.dlopen.RTLD_NOW);
  } catch { continue; }
  if (Object.keys(m.exports).length === 0) continue;

  let shaped = m.exports;
  const shapePath = join(ROOT, "runtime/node", module, "shape.mjs");
  if (existsSync(shapePath)) {
    try {
      const mod = await import(shapePath);
      if (typeof mod.shape === "function") shaped = mod.shape({ ...m.exports });
    } catch (error) {
      console.log("  SHIM THROWS  " + module + ": " + error.message.split("\n")[0].slice(0, 60));
      continue;
    }
  }

  let theirs;
  try { theirs = require("node:" + module); } catch { continue; }
  checked += 1;

  const differ = [], missing = [];
  const walk = (ours, them, path, depth) => {
    for (const key of Object.keys(them)) {
      let a, b;
      try { a = ours?.[key]; } catch { continue; }
      try { b = them[key]; } catch { continue; }
      if (typeof b === "function") {
        if (typeof a !== "function") missing.push(path + key + " (function)");
        continue;
      }
      if (b !== null && typeof b === "object") {
        if (a === null || typeof a !== "object") { missing.push(path + key + " (object)"); continue; }
        // Two levels, not one. `os.constants.signals` is a table inside a
        // table -- 33 entries -- and at one level it was checked for presence
        // and never compared. The same is true of `constants.errno`,
        // `constants.priority` and `constants.dlopen`, which is most of what
        // `os` publishes.
        //
        // Two is where it stops: node's `util.inspect.styles` is the deepest
        // plain table in the surface, and going further starts walking
        // prototypes and cyclic namespaces -- `path.posix.win32.posix` closes
        // in two hops.
        if (depth < 2) walk(a, b, path + key + ".", depth + 1);
        continue;
      }
      if (a === undefined && b !== undefined) { missing.push(path + key); continue; }
      if (!Object.is(a, b)) differ.push(path + key + ": ours " + String(a) + ", node " + String(b));
    }
  };
  walk(shaped, theirs, "", 0);

  if (differ.length === 0 && missing.length === 0) continue;
  totalDiffer += differ.length; totalMissing += missing.length;
  console.log("  " + module + ": " + differ.length + " differing, " + missing.length + " missing");
  for (const d of differ.slice(0, 6)) console.log("      DIFFERS  " + d.slice(0, 92));
  if (missing.length > 0) console.log("      (" + missing.length + " absent, which is the publish gap and not this question)");
}

console.log();
if (checked === 0) {
  console.log("  INSTRUMENT FAILURE: no module was comparable. An empty run is not a clean run.");
  process.exit(2);
}
console.log("  " + checked + " module(s) compared, " + totalDiffer +
  " value(s) differing, " + totalMissing + " absent");
console.log("  A differing value is the finding: both sides have the name and");
console.log("  disagree on what is behind it. Absence is the publish gap, which");
console.log("  every other instrument here already counts.");
