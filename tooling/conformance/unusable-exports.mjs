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
// A name is **unusable** when no argument shape succeeds *and* at least one
// raised a **boundary** error -- the runtime saying it cannot represent the
// value, in either direction.
//
// The first version of this required *every* shape to be a boundary error, and
// it missed `isUtf8`, which is the case it was written for. What `isUtf8`
// actually does:
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

for (const module of modules) {
  const addon = join(ROOT, "target/node", `${module}.node`);
  if (!existsSync(addon)) continue;
  if (Object.hasOwn(UNSAFE, module)) {
    console.log(`${module}: skipped -- ${UNSAFE[module]}`);
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
    const rows = []; let n = 0;
    for (const k of Object.keys(m.exports)) {
      const f = m.exports[k];
      if (typeof f !== "function") continue;
      n++;
      let anyOk = false; let boundary = 0; let validated = 0; let sample = "";
      for (const args of shapes) {
        try { f(...args); anyOk = true; break; }
        catch (e) {
          const msg = String(e && e.message);
          if (BOUNDARY.some((b) => msg.includes(b))) { boundary++; if (!sample) sample = msg.slice(0, 62); }
          else validated++;
        }
      }
      if (!anyOk && boundary > 0) rows.push({ name: k, why: sample, boundary, validated });
    }
    console.log(JSON.stringify({ functions: n, rows }));
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
  for (const row of result.rows) {
    console.log(`    UNUSABLE  ${row.name}  --  ${row.why}`);
    console.log(`              ${row.boundary} shape(s) hit the boundary, ${row.validated} reached the module's own validation, 0 succeeded`);
  }
}

console.log(`\n${unusable} of ${published} published function(s) are unusable: no argument shape succeeded and at least one hit the boundary.`);
console.log("Silence is not a clearance: the shapes are generic, so this can find an unusable name and cannot certify a usable one.");
