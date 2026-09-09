// Every published export, called with no arguments, against node's answer.
//
//   node tooling/conformance/no-arguments.mjs
//   node tooling/conformance/no-arguments.mjs path punycode
//
// # The question neither other instrument can express
//
// `differential-addon.mjs` compares answers on generated inputs, and its
// corpora always supply an argument -- a generator that produced "no arguments"
// would have nothing to generate. Node's own tests call these functions the way
// their authors meant them to be called. So the zero-argument call is a
// question both instruments are shaped not to ask, and it is the one place a
// wrapper's argument checks are the only thing that runs.
//
// It found something on its first run, on the module this profile calls whole:
// `punycode` is 3 of 3 on node's tests, all three behaviour-dependent under
// `--mutate-addon`, and 140,224 differential comparisons with zero divergences
// -- and **all four of its published functions answer `f()` differently from
// node**. So do nine of `path`'s eleven.
//
// Every difference so far is one cause: the wrapper's arity check fires before
// the module's own validation, so node's error code is replaced.
//
//     ours  path.dirname()   TypeError  ERR_MISSING_ARGS
//     node  path.dirname()   TypeError  ERR_INVALID_ARG_TYPE
//
// **`os` at 0 of 15 is the control that makes the rest readable**: its published
// functions take no required parameters, nothing fires, and the module answers.
// Without that row this would read as "wrappers break everything".
//
// # Why this is a report and not a gate
//
// Some of these differences are arguably improvements. Node's
// `punycode.decode()` has no validation at all and falls into a property read
// on `undefined`; a `TypeError` carrying `ERR_MISSING_ARGS` is more useful.
// Where node *does* validate, node is the oracle and we are wrong. Deciding
// which is which is a judgement per function, so this prints and does not fail.
//
// # Safety
//
// A zero-argument call can still do something. Modules whose exports open
// sockets, arm timers, touch the filesystem or spawn are skipped **by name with
// the reason**, rather than by a quiet allowlist -- a skipped module and a
// module with nothing to report must not print the same line.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

/** Modules a zero-argument call must not be made against, and why. */
const UNSAFE = {
  net: "createServer() and connect() bind sockets",
  dgram: "createSocket() opens a udp handle",
  http: "createServer() binds a listener",
  fs: "the sync surface touches the filesystem",
  timers: "setTimeout() and setInterval() arm the loop",
  readline: "createInterface() attaches to stdin",
  stream: "constructors allocate and register for cleanup",
  process: "reallyExit() and abort() end the process",
  child_process: "spawns",
  zlib: "constructors allocate native contexts",
  async_hooks: "createHook() installs a hook for the process lifetime",
  diagnostics_channel: "subscribe() registers for the process lifetime",
};

const argv = process.argv.slice(2);
const requested = argv.filter((a) => !a.startsWith("--"));
const modules = requested.length > 0
  ? requested
  : readdirSync(join(ROOT, "runtime/node"))
    .filter((m) => m !== "node_modules" && existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
    .sort();

let compared = 0;
let differing = 0;
for (const module of modules) {
  const addon = join(ROOT, "target/node", `${module}.node`);
  if (!existsSync(addon)) continue;
  if (Object.hasOwn(UNSAFE, module)) {
    console.log(`${module}: skipped -- ${UNSAFE[module]}`);
    continue;
  }

  // In a child, so a call that hangs or exits cannot take this process with it.
  const script = `
    const ours = require(${JSON.stringify(addon)});
    let node; try { node = require("node:${module}"); } catch { console.log(JSON.stringify({unavailable:true})); process.exit(0); }
    const outcome = (f) => {
      try { const v = f(); return ["ok", v === undefined ? "undefined" : typeof v === "object" && v !== null ? "[object]" : JSON.stringify(v)]; }
      catch (e) { return ["threw", (e && e.constructor && e.constructor.name) + " code=" + JSON.stringify(e && e.code)]; }
    };
    const rows = []; let n = 0;
    for (const k of Object.keys(ours)) {
      if (typeof ours[k] !== "function" || typeof node[k] !== "function") continue;
      n++;
      const a = outcome(ours[k]), b = outcome(node[k]);
      if (a[0] === b[0] && a[1] === b[1]) continue;
      rows.push({ name: k, ours: a.join(" "), node: b.join(" ") });
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
  if (result.unavailable === true) {
    console.log(`${module}: node has no such module to compare against`);
    continue;
  }
  compared += result.functions;
  differing += result.rows.length;
  console.log(`${module}: ${result.functions} published function(s), ${result.rows.length} differ on f()`);
  for (const row of result.rows) {
    console.log(`    ${row.name}()`);
    console.log(`        ours: ${row.ours}`);
    console.log(`        node: ${row.node}`);
  }
}

console.log(`\n${differing} of ${compared} published function(s) answer a zero-argument call differently from node.`);
console.log("A module reporting 0 with functions published is the control: it has no required parameters,");
console.log("so no wrapper check fires and the module itself answers.");
