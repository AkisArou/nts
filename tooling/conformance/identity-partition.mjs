// Which published names are the *same object*, differenced against node.
//
//   node tooling/conformance/identity-partition.mjs assert
//   for m in <modules>; do node tooling/conformance/identity-partition.mjs "$m"; done
//
// `surface-diff.mjs` asks whether the value behind a name is node's.
// `hidden-exports.mjs` asks whether a name reaches a test. Neither asks whether
// two names are backed by **one** object, and that is a contract node has, tests,
// and has no reason to state.
//
// # Why this seam
//
// `assert` exposes eighteen names on two surfaces. Node shares `ok`, `fail` and
// `ifError` between them and gives `deepEqual`, `equal` and their negations two
// implementations each -- and the shared `ok` is the callable `assert` itself, so
// one function answers to three names. Ours gave the strict surface its own `ok`.
// Every existing test passed: each assertion still *did* the right thing, and only
// identity differed. Nothing upstream asserts it because the invariant is a
// consequence of how node builds its own surfaces, not a behaviour anyone reported.
//
// That is the general shape. A module assembled out of parts will share objects
// wherever node's does not bother to copy, and a reimplementation assembled a
// different way will silently not.
//
// # What it compares
//
// Own enumerable paths to depth 2, restricted to values that *have* identity --
// functions and non-null objects. Primitives are excluded: two equal strings are
// `===` for reasons that say nothing about how the module was built.
//
// Only paths present on **both** sides are considered, so this reports identity
// divergence and never absence; absence is `surface-diff.mjs`'s column.
//
// Two findings, and both are defects:
//
//   SHARED-IN-NODE    node backs both names with one object, ours with two
//   DISTINCT-IN-NODE  node backs them with two, ours with one
//
// # What it could not run
//
// Printed, not skipped. A module whose TypeScript will not import, whose shim
// throws, or which node does not have is reported as such with the reason, and
// the pair count is printed for every module that *was* compared -- a module that
// comes back clean because it enumerated four paths is not the same result as one
// that enumerated forty, and only the number tells them apart.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const require = createRequire(import.meta.url);

const moduleName = process.argv[2];
if (!moduleName) {
  console.error("usage: identity-partition.mjs <module>");
  process.exit(2);
}

const say = (s) => console.log(`${moduleName}: ${s}`);

/** Own enumerable paths to `depth`, holding only values with identity. */
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
        // A throwing getter is not a comparison this can make. It is also not a
        // silent drop: it simply has no identity to compare.
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
  const moduleDir = join(ROOT, "runtime/node", moduleName);
  const main = join(moduleDir, "src/main.ts");
  if (!existsSync(main)) {
    say("not compared -- no src/main.ts");
    process.exit(0);
  }
  // The same preamble `run-one.mjs` performs, in the same order. Importing the
  // source without it fails on `nts_process_env_has is not defined`, which reads
  // as a defect in the module and is this instrument arriving too early.
  const shims = join(moduleDir, "bindings.node.mjs");
  if (existsSync(shims)) await import(shims);
  const globalsPath = join(moduleDir, "globals");
  if (existsSync(globalsPath)) {
    const { readFileSync } = await import("node:fs");
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
  const shapePath = join(ROOT, "runtime/node", moduleName, "shape.mjs");
  const input = { ...exports };
  ours = existsSync(shapePath)
    ? (await import(shapePath)).shape(input)
    : input;
} catch (error) {
  say(`not compared -- ours would not load: ${String(error.message).split("\n")[0].slice(0, 90)}`);
  process.exit(0);
}

const nodePaths = paths(nodeSurface, 2);
const ourPaths = paths(ours, 2);
const shared = [...nodePaths.keys()].filter((p) => ourPaths.has(p)).sort();

if (shared.length < 2) {
  say(`not compared -- ${shared.length} common path(s) with identity, need 2`);
  process.exit(0);
}

const findings = [];
let pairs = 0;
for (let i = 0; i < shared.length; i++) {
  for (let j = i + 1; j < shared.length; j++) {
    const a = shared[i], b = shared[j];
    pairs++;
    const inNode = nodePaths.get(a) === nodePaths.get(b);
    const inOurs = ourPaths.get(a) === ourPaths.get(b);
    if (inNode === inOurs) continue;
    findings.push({ a, b, kind: inNode ? "SHARED-IN-NODE  " : "DISTINCT-IN-NODE" });
  }
}

say(`${shared.length} common path(s), ${pairs} pair(s) compared, ${findings.length} divergence(s)`);
for (const f of findings) {
  const verb = f.kind.startsWith("SHARED")
    ? "node backs both with one object; ours with two"
    : "node backs them with two objects; ours with one";
  console.log(`  ${f.kind}  ${f.a} / ${f.b}\n                      ${verb}`);
}
