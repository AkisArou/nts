// Names the addon publishes that no shim hands to a test.
//
//   node tooling/conformance/hidden-exports.mjs
//   NTS_ADDON_OUT=<a private build> node tooling/conformance/hidden-exports.mjs
//
// # The case this generalises
//
// `stream/shape.mjs` did `if (Stream === undefined) return {}`. The compiled
// `stream` publishes `getDefaultHighWaterMark`, it answers 65536 / 16 / 65536
// for `false` / `true` / `undefined` exactly as node does, and the shape threw
// it away because an unrelated export was missing. Through the module the name
// was simply not there, and the module scored zero on the compiled axis.
//
// It was found by accident -- asking the raw `.node` with `process.dlopen` and
// getting a different answer than `require` gave. Nothing was looking, and the
// same shape of mistake is available to every shim.
//
// # Two questions, and the first version only asked the weaker one
//
// A shim exposes names four ways: the public object `shape()` returns, the ids
// `subpaths()` declares, the facade `internals()` builds, and `testBindings()`.
// The first version asked "reachable through any of them", and **it did not
// catch the case it was written for.** `stream/internals()` maps
// `getDefaultHighWaterMark` under `internal/streams/state`, so by that rule the
// name was never hidden -- while a test asking `require("stream")` for it got
// `undefined`.
//
// Controlled by putting the defect back: with `return {}` restored, the first
// version still reported `0 of them node own`. An instrument that cannot see
// the bug it was built from is worth exactly its runtime.
//
// The second version was controlled the same way, and it does see it:
//
//     stream: 1 published; 1 node-own name(s) not on the module, 0 reaching no test
//         NOT PUBLIC  getDefaultHighWaterMark: function  (reachable only through a facade)
//
// The parenthetical is the whole difference. The name was reachable -- through
// `internals()` -- and that is exactly why the first rule could not see it.
//
// So two questions:
//
//     NOT PUBLIC   a name **node has on its public surface**, published by the
//                  addon, and absent from the object `shape()` returns
//     hidden       published and reachable through none of the four
//
// `NOT PUBLIC` is the serious one: node own tests reach for it by name on the
// module, and this profile computes it and does not deliver it. `hidden` is
// weaker and often legitimate -- `readline` publishes four `kClear*` constants
// that reach tests through no path, and node has no such public names either.
//
// # A shim that throws is a finding, not a limitation
//
// The first version called that case `NOT ASKED` and moved on, and it cost
// hours. `http/shape.mjs` had an unguarded `class HTTPParser extends
// RawHTTPParser`; the compiled `http` publishes two names, so the heritage
// clause was `undefined` and `internals()` threw while being *built*. Every
// http test failed with `Class extends value undefined is not a constructor or
// null` before its first line ran, and this tool said it could not probe the
// module.
//
// Whatever a shim throws for here, some test is meeting it too. The line says
// `SHIM THROWS` now, quotes the message, and says so.
//
// # It cannot prove the opposite
//
// A name present in the shaped object may still be `undefined` there, and this
// counts it reachable. The question asked is "did the shim drop it", not "does
// it work" -- `unusable-exports.mjs` asks the second.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node");
const require = createRequire(import.meta.url);

/** Every key reachable from a value, one level in, as a flat set. */
function keysOf(value, into) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function") for (const k of Object.keys(value)) into.add(k);
    return;
  }
  for (const k of Object.keys(value)) {
    into.add(k);
    // Per key, because a shaped object carries accessors. `http` defines a
    // getter for `kHighWaterMark` that dereferences `this`, and reading it off
    // the object rather than an instance throws -- which the first version
    // attributed to `shape()` "calling into the module". `shape()` is fine;
    // the walk was not.
    let child;
    try { child = value[k]; } catch { continue; }
    if (child !== null && typeof child === "object") {
      try { for (const k2 of Object.keys(child)) into.add(k2); } catch { /* opaque */ }
    }
  }
}

const modules = readdirSync(join(ROOT, "runtime/node"))
  .filter((m) => m !== "node_modules" && existsSync(join(ADDON_DIR, m + ".node")))
  .sort();

let totalHidden = 0;
let totalNodes = 0;
let unreadable = 0;

for (const module of modules) {
  const m = { exports: {} };
  try {
    process.dlopen(m, join(ADDON_DIR, module + ".node"),
      require("node:os").constants.dlopen.RTLD_NOW);
  } catch (error) {
    console.log("  could not load  " + module + ": " + error.message.split("\n")[0].slice(0, 60));
    unreadable += 1;
    continue;
  }
  const published = Object.keys(m.exports).filter((k) => m.exports[k] !== undefined);
  if (published.length === 0) continue;

  const shapePath = join(ROOT, "runtime/node", module, "shape.mjs");
  let shapeModule = null;
  if (existsSync(shapePath)) {
    try { shapeModule = await import(shapePath); }
    catch (error) {
      console.log("  could not load  " + module + "/shape.mjs: " + error.message.split("\n")[0].slice(0, 50));
      unreadable += 1;
      continue;
    }
  }

  const reachable = new Set();
  const publicKeys = new Set();
  /* Values delivered anywhere in any facade, by identity. See the note at the
   * `hidden` computation for why a name is not enough. */
  const delivered = new Set();
  const collectValues = (value, depth) => {
    if (value === null || depth > 2) return;
    if (typeof value !== "object" && typeof value !== "function") return;
    if (delivered.has(value)) return;
    delivered.add(value);
    let keys = [];
    try { keys = Object.keys(value); } catch { return; }
    for (const key of keys) {
      let child;
      try { child = value[key]; } catch { continue; }
      collectValues(child, depth + 1);
    }
  };
  let unaskable = false;
  if (shapeModule === null) {
    for (const k of published) { reachable.add(k); publicKeys.add(k); }
  } else {
    for (const fn of ["shape", "subpaths", "internals", "testBindings"]) {
      if (typeof shapeModule[fn] !== "function") continue;
      // The call and the walk are separate, and reported separately. Blaming
      // the shim for a failure in this file's own traversal is how `http` was
      // reported as unaskable when only `internals()` is.
      let out;
      try {
        out = fn === "subpaths"
          ? shapeModule[fn]({ ...m.exports }, {})
          : shapeModule[fn]({ ...m.exports });
      } catch (error) {
        // A shim that throws on its own addon's exports is a **defect**, not a
        // limitation of this instrument, and it was read as the latter for
        // hours. `http/shape.mjs` did `class HTTPParser extends RawHTTPParser`
        // unguarded; the compiled `http` publishes two names, so
        // `exports.HTTPParser` was `undefined`, `internals()` threw while being
        // built, and **every http test failed with "Class extends value
        // undefined" before its first line ran**. This tool printed
        // `NOT ASKED http` and I filed that under "cannot probe it".
        //
        // So it is worded as what it is. Whatever this throws for, some test is
        // meeting it too.
        console.log("  SHIM THROWS     " + module + ": " + fn + "() throws on this addon's own exports");
        console.log("                  " + error.message.split("\n")[0].slice(0, 70));
        console.log("                  Every test that loads this module meets the same throw.");
        if (fn === "shape") unaskable = true;
        continue;
      }
      keysOf(out, reachable);
      collectValues(out, 0);
      if (typeof out === "function") for (const k of Object.keys(out)) reachable.add(k);
      if (fn === "shape") keysOf(out, publicKeys);
    }
  }
  if (unaskable) { unreadable += 1; continue; }

  let theirs = new Set();
  try { theirs = new Set(Object.keys(require("node:" + module))); } catch { /* no such module */ }

  // The serious question: node has this name on its public surface, the addon
  // publishes it, and `shape()` does not put it on the module.
  const notPublic = published.filter((k) => theirs.has(k) && !publicKeys.has(k));
  // The weaker one: reachable through nothing at all.
  //
  // **By name, not by value, and the difference is a whole category.**
  // `util/shape.mjs` does `util.inspect.styles = exports.styles` and then
  // `delete util.styles`, so the *name* `styles` reaches no test and the
  // *object* it names is what every test reading `util.inspect.styles` gets.
  // Reported as hidden, that is a finding about nothing: node has no top-level
  // `util.styles` either, and the shim is placing a value exactly where node
  // keeps it.
  //
  // So the value is looked for by identity anywhere in the delivered object
  // before a name is called hidden. What survives is a name whose value reaches
  // no test under any name -- which is the thing worth reading.
  const hidden = published.filter((k) => {
    if (reachable.has(k)) return false;
    const value = m.exports[k];
    // A primitive cannot be traced by identity, so it stays on the old rule
    // rather than being quietly cleared.
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return true;
    return !delivered.has(value);
  });
  if (notPublic.length === 0 && hidden.length === 0) continue;
  totalHidden += hidden.length;
  totalNodes += notPublic.length;

  console.log("  " + module + ": " + published.length + " published; " +
    notPublic.length + " node-own name(s) not on the module, " +
    hidden.length + " reaching no test at all");
  for (const k of notPublic) {
    console.log("      NOT PUBLIC  " + k + ": " + typeof m.exports[k] +
      (reachable.has(k) ? "  (reachable only through a facade)" : ""));
  }
  for (const k of hidden) {
    if (notPublic.includes(k)) continue;
    console.log("      hidden      " + k + ": " + typeof m.exports[k]);
  }
}

console.log();
if (modules.length === 0) {
  console.log("  INSTRUMENT FAILURE: no addon found under");
  console.log("  " + ADDON_DIR + ". An empty run is not a clean run.");
  process.exit(2);
}
console.log("  " + totalNodes + " node-own name(s) published and not on the module, " +
  totalHidden + " reaching no test at all" +
  (unreadable > 0 ? "; " + unreadable + " module(s) could not be asked" : ""));
console.log("  NOT PUBLIC is computed and not delivered: node own tests ask for it");
console.log("  by name. Reachability is the question here, not usability -- see");
console.log("  unusable-exports.mjs for whether a delivered name can be called.");
