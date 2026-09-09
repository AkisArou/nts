// Published names that cannot be called with anything.
//
//   node tooling/conformance/unusable-exports.mjs
//   node tooling/conformance/unusable-exports.mjs buffer async_hooks
//
// # Why appearing is not enough
//
// The erased-parameter crossing published nine names. Six answer exactly what
// node answers. Three cannot be called at all:
//
//     buffer.isUtf8(new Uint8Array([97,98]))   an argument of this type has no
//                                              representation in the compiled runtime
//     buffer.isAscii(new Uint8Array([97]))     the same
//     async_hooks.executionAsyncResource()     the compiled function returned a value
//                                              with no JavaScript representation
//
// `isUtf8` is declared `(input: Uint8Array | ArrayBuffer)`. The boundary accepts
// the *signature* and then finds it has no inbound representation for a typed
// array, so every argument node accepts throws -- `Buffer` included.
//
// **This is worse than not publishing.** Before, `typeof buffer.isUtf8` was
// `"undefined"` and a presence check failed honestly. Now it is `"function"`,
// the presence check passes, and only a call finds out. Every instrument that
// counts published names -- including this lane's own -- got two names better
// and nothing usable.
//
// # What it decides
//
// A name is reported when **any** argument shape hits a **boundary** error --
// the runtime saying it cannot represent the value, in either direction --
// split by whether anything worked:
//
//     UNUSABLE                        no shape succeeded
//     UNREACHABLE FOR SOME ARGUMENTS  some did
//
// It took two wrong criteria to get here, in opposite directions.
//
// **Too strict.** The first version required *every* shape to be a boundary
// error, and missed `isUtf8`, the case it was written for.
//
// **Too lenient.** The second required *no* shape to succeed, and reported
// `util` clean while `util.types.isDate(new Date())` threw. `isDate("")`
// returns `false` -- a success -- so the boundary failures behind it were never
// counted, and the loop stopped at the first success anyway. A predicate that
// answers for scalars and refuses references is the most common form of this
// defect and both criteria walked straight past it.
//
// Hence "any shape", and hence the split: a function that works for scalars and
// refuses references is a different finding from one that refuses everything,
// and one label for both would be wrong about whichever it was not describing.
//
// What `isUtf8` actually does:
//
//     isUtf8(undefined) (""), (0), (true), (null)   The "input" argument must be
//                                                   an instance of ArrayBuffer…
//     isUtf8([]), ({}), (Uint8Array), (ArrayBuffer) an argument of this type has no
//                                                   representation…
//
// So scalars cross fine and reach the module's own validation, which answers
// exactly what node answers. The boundary rejects the *reference* types -- and
// those are the only ones `isUtf8` accepts. Requiring every shape to be a
// boundary error asks for a function with no working validation, which is a
// different and rarer thing.
//
// A name that throws ordinary validation errors for everything and never a
// boundary error is not reported: that is a function correctly refusing bad
// arguments, which is what node does too.
//
// It cannot prove a name *is* usable: the shapes below are generic, and a
// function needing a live socket will throw for reasons this cannot read. So
// the output is one-sided on purpose -- `UNUSABLE` is a finding, silence is not
// a clearance.
//
// Modules whose exports open handles or end the process are skipped by name
// with the reason, as in `no-arguments.mjs`.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

// `target/node` is shared with the other sessions in this tree, so a run that
// names it measures whatever they last wrote. `NTS_ADDON_OUT` is the variable
// `build.sh`, `loads.sh` and `axis-controls.mjs` already take; the default is
// unchanged, so every existing caller behaves as before.
//
// Not hypothetical: this file reported ten functions whose `length` disagrees
// with their own arity check, against artifacts of unknown vintage that another
// lane had built. The finding may still be real -- but it was not a measurement
// of anything this session built, and it read as one.
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node");

const UNSAFE = {
  net: "binds sockets",
  dgram: "opens a udp handle",
  http: "binds a listener",
  fs: "touches the filesystem",
  timers: "arms the loop",
  readline: "attaches to stdin",
  stream: "allocates and registers for cleanup",
  process: "can end the process",
  zlib: "allocates native contexts",
  diagnostics_channel: "registers for the process lifetime",
};

/** The runtime's own "I cannot carry this" messages, in both directions. */
const BOUNDARY = [
  "has no representation in the compiled runtime",
  "no JavaScript representation",
  "cannot be represented",
];

const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modules = argv.length > 0
  ? argv
  : readdirSync(join(ROOT, "runtime/node"))
    .filter((m) => m !== "node_modules" && existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
    .sort();

let published = 0;
let unusable = 0;
let dishonestTotal = 0;
const skipped = [];

for (const module of modules) {
  const addon = join(ADDON_DIR, `${module}.node`);
  if (!existsSync(addon)) continue;
  if (Object.hasOwn(UNSAFE, module)) {
    console.log(`${module}: skipped -- ${UNSAFE[module]}`);
    skipped.push(module);
    continue;
  }

  const script = `
    const flags = require("node:os").constants.dlopen;
    const m = { exports: {} };
    process.dlopen(m, ${JSON.stringify(addon)}, flags.RTLD_NOW);
    const BOUNDARY = ${JSON.stringify(BOUNDARY)};
    // Generic shapes: nothing, and one of each kind the boundary distinguishes.
    const shapes = [[], [undefined], [""], ["x"], [0], [1], [true], [[]], [{}],
                    [new Uint8Array([97])], [new ArrayBuffer(2)], [null], ["x", "y"]];
    // One level into published objects as well as the top level.
    //
    // util.types is a plain object of 31 predicates, and every one taking a
    // reference throws at the boundary -- isDate(new Date()), isMap(new Map()),
    // isPromise(...) -- while node answers true. A walk over the top level
    // alone reported util clean, because types is an object and not a function.
    // (No backticks in this comment: it lives inside a template literal.)
    const targets = [];
    for (const k of Object.keys(m.exports)) {
      const v = m.exports[k];
      if (typeof v === "function") { targets.push([k, v]); continue; }
      if (v !== null && typeof v === "object") {
        for (const k2 of Object.keys(v)) {
          if (typeof v[k2] === "function") targets.push([k + "." + k2, v[k2]]);
        }
      }
    }
    // A function that demands more arguments than its own length reports.
    //
    // Once the wrapper began setting Function.prototype.length from the
    // signature, the property and the arity check stopped agreeing:
    // readline.reverseString reports 1 -- node's number -- and throws
    // "requires 3 arguments" when called with one. length counts up to the
    // first optional parameter and the check counts every declared one.
    //
    // The one case where a caller doing exactly what the function says still
    // fails, and it appeared as a consequence of a fix rather than as a
    // regression: before it every length was 0 and nothing could disagree.
    // (No backticks in this comment: it lives inside a template literal, and
    // that has broken this directory three times today.)
    const dishonest = [];
    for (const [k, f] of targets) {
      let demanded = null;
      try { f(...new Array(f.length).fill(undefined)); }
      catch (e) {
        // Two backslashes: this lives in a template literal, and a single one
        // collapses -- the regex reached the child as /requires (d+) argument/
        // and matched nothing, so this check reported 0 disagreements against
        // an addon a standalone probe had already found four in. The escape
        // trap and the backtick trap are the same trap.
        const found = /requires (\\d+) argument/.exec(String(e && e.message));
        if (found !== null) demanded = Number(found[1]);
      }
      if (demanded !== null && demanded > f.length) dishonest.push([k, f.length, demanded]);
    }
    const rows = []; let n = 0;
    for (const [k, f] of targets) {
      n++;
      // Every shape is tried, not stopped at the first success.
      //
      // util.types.isDate returns false for a string and throws at the boundary
      // for a Date -- the argument it exists to accept. Stopping at the first
      // success reported it clean, because a scalar crosses and answers.
      let ok = 0; let boundary = 0; let validated = 0; let sample = "";
      for (const args of shapes) {
        try { f(...args); ok++; }
        catch (e) {
          const msg = String(e && e.message);
          if (BOUNDARY.some((b) => msg.includes(b))) { boundary++; if (!sample) sample = msg.slice(0, 62); }
          else validated++;
        }
      }
      if (boundary > 0) {
        rows.push({ name: k, why: sample, boundary, validated, ok,
                    kind: ok === 0 ? "UNUSABLE" : "UNREACHABLE FOR SOME ARGUMENTS" });
      }
    }
    console.log(JSON.stringify({ functions: n, rows, dishonest }));
  `;
  const run = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 60_000 });
  const line = `${run.stdout ?? ""}`.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (line === undefined) {
    console.log(`${module}: could not be asked (exit ${run.status})`);
    continue;
  }
  const result = JSON.parse(line);
  published += result.functions;
  unusable += result.rows.length;
  if (result.functions === 0) continue;
  console.log(`${module}: ${result.functions} published function(s), ${result.rows.length} unusable`);
  for (const [name, length, demanded] of result.dishonest ?? []) {
    console.log(`    ARITY DISAGREES  ${name}  length ${length}, demands ${demanded}`);
    dishonestTotal += 1;
  }
  for (const row of result.rows) {
    console.log(`    ${row.kind}  ${row.name}  --  ${row.why}`);
    console.log(`              ${row.boundary} shape(s) hit the boundary, ${row.validated} reached the module's own validation, ${row.ok} succeeded`);
  }
}

console.log(`\n${unusable} of ${published} published function(s) refuse at least one argument shape at the boundary. UNUSABLE means none succeeded.`);
console.log(`${dishonestTotal} of them demand more arguments than their own length reports -- the one` +
  " case where a caller doing exactly what the function says still fails.");
if (skipped.length > 0) {
  console.log(`  Not asked: ${skipped.join(", ")}. Those are skipped whole, so the` +
    " arity figure above is over the modules that were called, not over all of them.");
  console.log("  `arity-agreement.mjs` reads both numbers out of the emitted C and covers");
  console.log("  them all -- it reports 4 where this reports 2, and the difference is");
  console.log("  `fs.Stats` and `readline.reverseString`, in modules this cannot call.");
}
console.log("Silence is not a clearance: the shapes are generic, so this can find an unusable name and cannot certify a usable one.");
