// Published classes whose instances share a field shape, and whether a shared
// layout could make `instanceof` confuse them.
//
//   node tooling/conformance/same-shape-classes.mjs <module> [module …]
//
// # The other half of `merged-layouts.mjs`
//
// Two classes whose fields match exactly share one layout and one descriptor, so
// `new B() instanceof A` answers `true` where node answers `false`. Nothing
// refuses; it compiles and answers wrongly.
//
// `merged-layouts.mjs` reads the answer out of the compiler and under-reports:
// its signal is the `this` parameter of a lowered method, so a class with neither
// constructor nor methods emits no line and **field-less siblings are invisible
// to it**. Those are one of the two ways a layout gets shared. This file is that
// half -- it sees them, because two field-less classes appear here as instances
// with matching own keys.
//
//     merged-layouts   sees fields and the base; blind to field-less siblings
//     this file        sees field-less siblings; blind to nothing it does not
//                      then read out of the source
//
// # One module per invocation, and why
//
// Sweeping twenty-two in one process hung for eleven minutes with no output: a
// constructed class can hold the event loop open. Driven from a shell loop with a
// per-module timeout, a module that hangs costs one row.
//
// It also constructs only **classes**, not every function with a `prototype`.
// `new process.abort()` *called* `abort` and killed the process mid-sweep, and
// `new join()` yields an empty object, which put three `path` function pairs in
// the output as same-shaped "classes".
//
// # Own keys nominate; the source decides
//
// The shape measure is own enumerable keys of a no-argument instance, and **"no
// own fields" is indistinguishable from "only private fields"** -- which is where
// the layout actually lives. All three of the at-risk pairs this first produced
// were false: `Blob` has four private fields against `Buffer`'s none, `BlockList`
// three against `BoundSocket`'s none, and `net.Socket` twenty-seven while
// `Stream` has none. Three of three, in the one category the layout sweep cannot
// reach.
//
// So a nominated pair is then read from source for its `#private` fields and its
// `extends` clause, and eliminated if either differs. Two traps in that lookup,
// both hit:
//
//   - a bare search across `runtime/node` found **dgram**'s `Socket` for a
//     question about `net`'s, and answered confidently. The declaring module is
//     tried first, and a wider search must find exactly one class or it returns
//     nothing rather than a guess.
//   - a class published by one module can be *declared* in another and
//     re-exported. `Stream` is `stream`'s and `net` publishes it, so a
//     module-scoped lookup returned null and left the pair standing.
//
// # Chains are safe; siblings are not
//
// A subclass adding no fields carries its parent's field list exactly, which
// looks like the worst case and is not one: `parent instanceof Child` is false
// and `child instanceof Parent` is true, both right. What collapses is two
// *siblings* that each add nothing. So every pair is classified, and only
// `SIBLING/UNRELATED` is at risk.
//
// The classification walks the **prototype** chain, not the constructor chain.
// `stream`'s shim wraps each class in a callable facade whose prototype is the
// real class, so a constructor walk stops one link in -- it called
// `Duplex`/`PassThrough` siblings when they are three links of one chain.
// `instanceof` consults `X.prototype`, and the facade shares the real class's
// `prototype` object.
//

//
// Seven nominated pairs across 22 modules; three classified at risk; all three
// eliminated from source. The four survivors are chains. **No at-risk pair in
// `runtime/node`.**

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { loadOurs } from "./surface-load.mjs";

// **One module per invocation.** A first version swept all twenty-two in one
// process and hung with no output for eleven minutes: constructing a class can
// leave a handle open, and one module that never lets the loop drain takes the
// whole sweep with it. Driven from a shell loop with a per-module timeout, a
// module that hangs costs one row.
const MODULES = process.argv.slice(2);
if (MODULES.length === 0) {
  console.error("usage: twins.mjs <module> [module …]");
  process.exit(2);
}

const sources = execSync(
  "find runtime/node -name '*.ts' -not -path '*/node_modules/*'",
  { cwd: "/home/akisarou/Projects/nts", encoding: "utf8" },
).trim().split("\n");
const allText = sources.map((f) => readFileSync(`/home/akisarou/Projects/nts/${f}`, "utf8")).join("\n");
const comparedByInstanceof = (name) => new RegExp(`instanceof\\s+${name}\\b`).test(allText);

/**
 * A class's `#private` field names and its `extends` clause, read from source.
 *
 * **Without this the sweep is worthless for exactly the pairs it is needed for.**
 * Its shape measure is own enumerable keys, and "no own fields" is
 * indistinguishable from "only private fields" -- which is where the layout
 * actually lives. All three of its at-risk candidates were false: `Blob` has four
 * private fields against `Buffer`'s none, `BlockList` three against
 * `BoundSocket`'s none, and `net.Socket` twenty-seven while `Stream` has none.
 * Three of three, in the one category the layout sweep cannot reach.
 *
 * Read from the declaring module only. A bare search across `runtime/node` found
 * **dgram**'s `Socket` when the question was `net`'s, and answered confidently.
 */
function declaredShape(moduleName, className) {
  // The declaring module first, then the whole tree -- **but only if the wider
  // search finds exactly one**. A class published by `net` can be declared in
  // `stream` and re-exported, which is why the module-scoped version returned
  // null for `Stream` and left `net: Socket / Stream` standing. And a
  // first-match-wins widening is what found *dgram*'s `Socket` for a question
  // about `net`'s, so ambiguity returns null rather than a guess.
  const declares = new RegExp(`^\\s*(export )?(abstract )?class ${className}\\b`, "m");
  const inModule = [];
  const anywhere = [];
  for (const f of sources) {
    const text = readFileSync(`/home/akisarou/Projects/nts/${f}`, "utf8");
    if (!declares.test(text)) continue;
    anywhere.push(text);
    if (f.startsWith(`runtime/node/${moduleName}/`)) inModule.push(text);
  }
  const file = inModule.length === 1 ? inModule[0]
    : anywhere.length === 1 ? anywhere[0]
    : null;
  if (file === null) return null;
  const at = file.search(new RegExp(`^\\s*(export )?(abstract )?class ${className}\\b`, "m"));
  const body = file.slice(at, at + 6000);
  const base = /^\s*(?:export )?(?:abstract )?class \w+\s+extends\s+([\w.]+)/.exec(body);
  const privates = [...body.matchAll(/^\s+(?:readonly )?(#[a-zA-Z][\w]*)/gm)].map((x) => x[1]);
  return `base=${base ? base[1] : "none"};priv=${[...new Set(privates)].sort().join("+")}`;
}

let live = 0, latent = 0, classes = 0;
for (const m of MODULES) {
  let ours;
  try { ours = await loadOurs(m); } catch { continue; }
  if (ours.absent) continue;
  const shapes = [];
  for (const name of Object.keys(ours.surface)) {
    let C;
    try { C = ours.surface[name]; } catch { continue; }
    // **A real class, not any function with a `prototype`.** Two things went
    // wrong without this. `new process.abort()` *called* `abort` and killed the
    // process mid-sweep -- `instance-shape-diff.mjs`'s header warns about exactly
    // that risk and I walked into it. And `path.join`/`toNamespacedPath` came out
    // as same-shaped "classes" with no own fields, because `new join()` yields an
    // empty object; three of those pairs were pure noise.
    //
    // A class has more than `constructor` on its prototype; a plain function's
    // prototype has only that. Same test `corpus-reach.mjs` uses.
    if (typeof C !== "function" || C.prototype === undefined || C.prototype === null) continue;
    if (Object.getOwnPropertyNames(C.prototype).length <= 1) continue;
    let inst;
    try { inst = new C(); } catch { continue; }
    if (inst === null || typeof inst !== "object") continue;
    classes++;
    shapes.push([name, Object.keys(inst).sort().map((k) => `${k}:${typeof inst[k]}`).join(",")]);
  }
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (shapes[i][1] !== shapes[j][1]) continue;
      const a = shapes[i][0], b = shapes[j][0];
      const A = ours.surface[a], B = ours.surface[b];
      // **Ancestor/descendant is safe; siblings collapse.** Established with
      // layouts by the compiler lane: a subclass adding no fields carries its
      // parent's field list and stays distinguishable from it in both
      // directions, while two field-less *siblings* of one parent do not. A
      // same-shape pair means nothing until it is classified, and the first
      // version of this sweep reported chains and siblings identically.
      // **Walk the prototype chain, not the constructor chain.** The first
      // version walked `Object.getPrototypeOf(Class)` and called
      // `Duplex`/`PassThrough` siblings -- because `stream`'s shim wraps each
      // class in a callable facade whose prototype is the *real class*, so the
      // walk stops one link in and never reaches `Transform`. `instanceof`
      // consults `X.prototype`, so that is what decides whether a pair is a
      // chain, and it is immune to the facade because the facade shares the real
      // class's `prototype` object.
      const descends = (X, Y) => {
        try {
          return X !== Y && Y.prototype !== undefined && X.prototype !== undefined &&
            Y.prototype.isPrototypeOf(X.prototype);
        } catch {
          return false;
        }
      };
      const related = descends(A, B) || descends(B, A) ? "chain" : "SIBLING/UNRELATED";
      // The declared shape decides a sibling pair; own keys only nominated it.
      const da = declaredShape(m, a), db = declaredShape(m, b);
      if (related !== "chain" && da !== null && db !== null && da !== db) {
        console.log(`  eliminated   ${m}: ${a} / ${b}  differ in source: ${da.slice(0, 40)} vs ${db.slice(0, 40)}`);
        continue;
      }
      const hot = comparedByInstanceof(a) || comparedByInstanceof(b);
      if (hot) live++; else latent++;
      console.log(`  ${related === "chain" ? "safe   " : "AT RISK"}  ${hot ? "LIVE  " : "latent"}  ${m}: ${a} / ${b}  (${related})  [${shapes[i][1].slice(0, 40) || "no own fields"}]`);
    }
  }
}
console.log(`\n  ${live} live, ${latent} latent, among ${classes} no-argument-constructible published class(es)`);
// A constructed class can hold the loop open, so the answer is printed and the
// process is ended rather than waited on.
process.exit(0);
