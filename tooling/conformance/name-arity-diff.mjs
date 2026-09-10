// Every published function's `name` and `length`, differenced against node.
//
//   node tooling/conformance/name-arity-diff.mjs path
//
// `arity-agreement.mjs` asks whether a *compiled* function's `length` agrees with
// the arity it demands, read out of the emitted C. This asks a different question
// on the other lane: does the function a test reaches report the name and arity
// **node's** reports? A function can demand exactly what it advertises and still
// advertise the wrong thing.
//
// # Why it is worth asking separately
//
// `identity-partition.mjs` found six wrong names, and found them by accident --
// it was looking for shared objects and the names came out in the diagnosis.
// `console.dirxml` reported `name` `"log"`, and `profile`, `profileEnd` and
// `timeStamp` all reported `"noopLabel"` with `length` 1 where node reports 0.
// Nothing was looking for that, so nothing else would have found it.
//
// Node's own suite has little reason to check either: a name is whatever the
// declaration was called, and `length` follows from the parameter list. Both are
// observable, and both are things a reimplementation can get wrong while
// computing the right answer.
//
// # What it compares, and what it declines to
//
// Own enumerable paths to depth 2 that are functions on **both** sides. A class
// and a plain function are both callable and both compared -- `name` and `length`
// mean the same thing for each.
//
// Bound functions are excluded by name rather than by guess: node binds console's
// methods per instance and then redefines `.name`, so a `"bound "` prefix would be
// node's own artefact rather than a divergence. None is currently reported; the
// exclusion is stated so that a future one is not read as agreement.
//
// Absence is not this instrument's column and is never reported as a difference.
// What it could not run is printed: modules node does not have, modules whose
// TypeScript will not import, and the count of paths compared, so that a clean
// answer over four paths is distinguishable from a clean answer over four hundred.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const require = createRequire(import.meta.url);

const moduleName = process.argv[2];
if (!moduleName) {
  console.error("usage: name-arity-diff.mjs <module>");
  process.exit(2);
}
const say = (s) => console.log(`${moduleName}: ${s}`);

function paths(root, depth) {
  const out = new Map();
  const walk = (value, prefix, level) => {
    let keys;
    try {
      keys = Object.keys(value);
    } catch {
      return;
    }
    for (const key of keys) {
      let child;
      try {
        child = value[key];
      } catch {
        continue;
      }
      const hasIdentity = typeof child === "function" ||
        (typeof child === "object" && child !== null);
      if (!hasIdentity) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      out.set(path, child);
      if (level < depth) walk(child, path, level + 1);
    }
  };
  walk(root, "", 1);
  return out;
}

let nodeSurface;
try {
  nodeSurface = require(`node:${moduleName}`);
} catch (error) {
  say(`not compared -- node has no such builtin (${error.code ?? "?"})`);
  process.exit(0);
}

let ours;
try {
  const dir = join(ROOT, "runtime/node", moduleName);
  const main = join(dir, "src/main.ts");
  if (!existsSync(main)) {
    say("not compared -- no src/main.ts");
    process.exit(0);
  }
  const shims = join(dir, "bindings.node.mjs");
  if (existsSync(shims)) await import(shims);
  const globalsPath = join(dir, "globals");
  if (existsSync(globalsPath)) {
    const wanted = readFileSync(globalsPath, "utf8").split("\n").map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
    for (const name of wanted) {
      if (name === "abort") {
        const abort = await import(join(ROOT, "runtime/web-platform/src/core/abort.ts"));
        globalThis.AbortController = abort.AbortController;
        globalThis.AbortSignal = abort.AbortSignal;
      } else if (name === "encoding") {
        const encoding = await import(join(ROOT, "runtime/web-platform/src/core/encoding.ts"));
        globalThis.TextEncoder = encoding.TextEncoder;
        globalThis.TextDecoder = encoding.TextDecoder;
      }
    }
  }
  const exports = await import(main);
  const shapePath = join(dir, "shape.mjs");
  const input = { ...exports };
  ours = existsSync(shapePath) ? (await import(shapePath)).shape(input) : input;
} catch (error) {
  say(`not compared -- ours would not load: ${String(error.message).split("\n")[0].slice(0, 90)}`);
  process.exit(0);
}

const nodePaths = paths(nodeSurface, 2);
const ourPaths = paths(ours, 2);

// Node's *global* console -- the object `require('node:console')` returns -- has
// every method at `length` 0, whatever the prototype declares:
//
//     log 0/0   dir 2/0   assert 1/0   table 2/0   group 0/0   ...
//     every global console method has length 0: true
//
// That uniformity is the justification. It is not three methods with the wrong
// arity; it is V8's inspector console replacing the whole family, and the three
// that show up here are simply the three whose declared arity is not already 0.
// Matching it would mean redefining `length` on our own functions, which this
// profile does not do.
//
// Narrow on purpose, and printed rather than dropped: an exclusion that quietly
// swallows a real defect is worse than the noise it removes. If a fourth console
// path ever appears here, it is not covered by this and should not be added to it
// without re-deriving the uniformity above.
const ARTEFACTS = {
  console: {
    paths: new Set(["dir", "assert", "table"]),
    why: "node's global console is uniformly length 0 (V8 inspector wrapping)",
  },
};

let compared = 0, bound = 0, artefact = 0;
const nameDiff = [], arityDiff = [];
for (const [path, theirs] of nodePaths) {
  if (!ourPaths.has(path)) continue;
  const mine = ourPaths.get(path);
  if (typeof theirs !== "function" || typeof mine !== "function") continue;
  if (theirs.name.startsWith("bound ")) { bound++; continue; }
  compared++;
  if (theirs.name !== mine.name) {
    nameDiff.push(`${path}  node ${JSON.stringify(theirs.name)}  ours ${JSON.stringify(mine.name)}`);
  }
  if (theirs.length !== mine.length) {
    if (ARTEFACTS[moduleName]?.paths.has(path)) {
      artefact++;
    } else {
      arityDiff.push(`${path}  node length ${theirs.length}  ours ${mine.length}`);
    }
  }
}

if (compared === 0) {
  say("not compared -- no path is a function on both sides");
  process.exit(0);
}

const skipped = bound > 0 ? `, ${bound} bound-name path(s) excluded` : "";
say(`${compared} function path(s) compared${skipped}, ${nameDiff.length} name, ${arityDiff.length} arity`);
if (artefact > 0) {
  console.log(`  ${artefact} arity difference(s) held as known: ${ARTEFACTS[moduleName].why}`);
}
for (const d of nameDiff) console.log(`  NAME   ${d}`);
for (const d of arityDiff) console.log(`  ARITY  ${d}`);
