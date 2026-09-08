// What a `shape.mjs` supplies rather than passes through.
//
//   node tooling/conformance/shape-blindspot.mjs
//
// A shape shim builds the object node's tests see out of a module's exports. It
// is supposed to add *shape* and no behaviour. Where it adds a value instead,
// every test that reads that value is testing this repository's harness and not
// the artifact, and it passes whatever the module does.
//
// That is not hypothetical. `path/shape.mjs` called
// `pathVariant(exports, "/", ":")` and used those literals for `sep` and
// `delimiter`, which the module also exports. A module shipping
// `export const sep = "\\"` passed **21 of 21 with zero failures**, because the
// value under test never reached the object being tested. It was found by
// reading the file, and the note written at the time said a grep is a weaker
// instrument than the question deserves. This is the instrument.
//
// The method is dynamic rather than syntactic: call `shape()` with an exports
// object whose every property is a unique sentinel, then walk what comes back.
// Any leaf that is not one of those sentinels was invented by the shim. That
// catches a literal, a computed string, a default and a value copied from
// somewhere else, none of which a regular expression over the source will find
// reliably.

import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NODE_DIR = join(ROOT, "runtime/node");


/* A property access on this yields a fresh sentinel and records the path, so a
 * shim can read anything it likes without a prepared list of names. Everything
 * it hands back is traceable to the exports object it came from. */
const sentinels = new Set();

/* Recursive, and the first version was not -- which produced findings rather
 * than noise-free silence, so it is worth saying why. A shim that reaches
 * `exports.win32.relative` got a plain object at `win32` and `undefined` from
 * it, and `undefined` is not a sentinel, so every nested read was reported as a
 * value the shim invented. Eleven false positives in `path` alone, each of them
 * exactly the shape of a real finding. An instrument whose failure mode is
 * *fabricating* the thing it looks for is worse than none. */
function sentinelExports(label) {
  const cache = new Map();
  const proxy = new Proxy(function sentinel() {}, {
    get(_target, key) {
      if (key === "__sentinelPath") return label;
      if (typeof key === "symbol") return undefined;
      const next = `${label}.${String(key)}`;
      if (!cache.has(key)) cache.set(key, sentinelExports(next));
      return cache.get(key);
    },
    // A shim may read a name and then a name off *that*; both are the module's
    // to answer, and neither is invented here.
    has() { return true; },
    // A function target has non-configurable own `prototype`, `length` and
    // `name`, and a proxy that omits them from `ownKeys` throws rather than
    // lying. Eight shims were reported "not probeable" for that alone.
    ownKeys(target) { return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    apply() { return sentinelExports(`${label}()`); },
    construct() { return sentinelExports(`new ${label}`); },
  });
  sentinels.add(proxy);
  return proxy;
}

/** Every leaf of `value`, with the path that reached it. */
function leaves(value, path, seen, out, depth = 0) {
  if (depth > 4) return;
  if (sentinels.has(value)) { out.push([path, value]); return; }
  if (value === null || typeof value !== "object") { out.push([path, value]); return; }
  if (seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    let child;
    try { child = value[key]; } catch { continue; }
    leaves(child, `${path}.${key}`, seen, out, depth + 1);
  }
}

const modules = readdirSync(NODE_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "node_modules")
  .map((e) => e.name)
  .sort();

let checked = 0;
let supplying = 0;
let unrunnable = 0;
const findings = [];

for (const name of modules) {
  const shapePath = join(NODE_DIR, name, "shape.mjs");
  if (!existsSync(shapePath)) continue;
  let shape;
  try {
    ({ shape } = await import(shapePath));
  } catch (error) {
    console.log(`  could not load  ${name}: ${error.message.split("\n")[0]}`);
    unrunnable++;
    continue;
  }
  if (typeof shape !== "function") continue;
  checked++;

  let shaped;
  try {
    shaped = shape(sentinelExports(name));
  } catch (error) {
    // A shim that *calls* what the module exports cannot be probed this way --
    // `url` constructs a `URLSearchParams` to reach its iterator prototype. Say
    // so rather than counting it clean, which is the failure this whole
    // directory is against.
    console.log(`  NOT PROBED      ${name}: shape() calls into the module (${error.message.split("\n")[0]})`);
    unrunnable++;
    continue;
  }

  const out = [];
  leaves(shaped, name, new WeakSet(), out);
  // A function the shim built is not automatically a supplied *value*. Node's
  // `assert` is callable and forwards to `assert.ok`, so the shim has to
  // construct a wrapper -- but the behaviour is still the module's, and calling
  // that wrapper hands back a sentinel. Distinguishing the two is the
  // difference between a finding and a false alarm, and the first version of
  // this could not: it reported `assert` as supplying a value when every answer
  // it gives comes from the module.
  // Two ways a wrapper can forward, and checking only one produced a second
  // false alarm. `http.ClientRequest` is a constructor wrapper built around
  // `Reflect.construct`, so *calling* it plainly does not reach the module and
  // it looked like an invented value; constructing it does.
  const delegates = (fn) => {
    for (const attempt of [
      () => fn(sentinelExports("probe")),
      () => Reflect.construct(fn, [sentinelExports("probe")]),
    ]) {
      try {
        if (sentinels.has(attempt())) return true;
      } catch { /* the other form may still reach it */ }
    }
    return false;
  };
  const invented = out.filter(([, v]) => {
    if (sentinels.has(v)) return false;
    if (typeof v === "function" && delegates(v)) return false;
    return true;
  });
  if (invented.length === 0) {
    console.log(`  passes through  ${name}`);
    continue;
  }
  supplying++;
  console.log(`  SUPPLIES ${String(invented.length).padStart(2)}     ${name}`);
  // Describing a value must not itself throw. A proxy over a function has no
  // `Symbol.toPrimitive` and `String(...)` on it raises -- which killed the run
  // mid-module and lost every result after `http`.
  const describe = (value) => {
    try {
      if (typeof value === "function") return `function ${value.name || "(anonymous)"}`;
      const json = JSON.stringify(value);
      if (json !== undefined) return json;
      return Object.prototype.toString.call(value);
    } catch {
      return "(a value that cannot be described)";
    }
  };
  for (const [path, value] of invented.slice(0, 6)) {
    findings.push(`${path} = ${describe(value)}`);
    console.log(`                    ${path} = ${describe(value)}`);
  }
}

console.log();
if (checked === 0) {
  console.log("  INSTRUMENT FAILURE: no shape.mjs exported a `shape` function.");
  console.log("  An empty run is not a clean run. Check the glob and the export");
  console.log("  name before believing this.");
  process.exit(2);
}
console.log(`  ${checked} shim(s) probed, ${supplying} supplying a value, ` +
  `${unrunnable} not probeable`);
console.log("  A supplied value is tested by nobody: the module could return");
console.log("  anything and every test that reads it would still pass.");
