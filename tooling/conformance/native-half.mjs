// Which declared bindings have no C anywhere.
//
//   node tooling/conformance/native-half.mjs
//   node tooling/conformance/native-half.mjs dgram net
//
// # Why this is a separate question from compiling
//
// A binding is a `declare function` in TypeScript whose implementation is a C
// symbol of the same name. **Compiling is necessary and not sufficient**: a
// module whose TypeScript lowers perfectly still fails to link if the symbol it
// names does not exist. That failure arrives at link time, after every
// diagnostic the compiler could give, and it is invisible to every instrument in
// this directory that reads refusals.
//
// It is also the one tranche of this profile's work that **needs no compiler**:
// a missing binding is C somebody has to write, and writing it does not wait on
// the lowering.
//
// # Derived with `nm`, never a regex
//
// The definitive answer is what the linker will see, and the only thing that
// knows that is the object file. Each module's C is compiled to an object with
// the same include flags `build.sh` uses, and `nm --defined-only` gives the
// symbols that exist. Two regexes over the C were tried on an earlier occasion
// and **gave two different wrong answers** -- a definition split across lines, a
// name inside a comment, a static helper that is not linkable, and a macro that
// expands to a definition are each enough to break one.
//
// The declaration side is read from the TypeScript, where `declare function X`
// is the whole of the contract and there is nothing for a compiler to disagree
// about.
//
// # What a missing binding is not
//
// It is not necessarily a defect. A module may declare a binding it never
// reaches, and the link only fails if something calls it. So the output
// separates *declared* from *missing*, and says that a nonzero missing count is
// a link failure waiting for the lowering to arrive rather than one happening
// now.

import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NODE_DIR = join(ROOT, "runtime/node");

const RUN_ROOT = mkdtempSync(join(tmpdir(), "nts-native-"));
process.on("exit", () => {
  if (process.env.NTS_KEEP_TEMP === undefined) {
    try { rmSync(RUN_ROOT, { recursive: true, force: true }); } catch { /* going away */ }
  } else {
    console.log(`  kept ${RUN_ROOT}`);
  }
});

/** Every `.c` under runtime/node, compiled once. */
function definedSymbols() {
  // **Both trees, and the second one was found by a false positive.** A first
  // version walked `runtime/node` alone and reported `nts_checkpoint` as having
  // no C. It has C -- in `runtime/c`, which is where the shared runtime lives
  // and which a module's addon links against. A binding may be implemented by
  // either tree and the linker does not care which.
  const sources = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".c")) sources.push(path);
    }
  };
  walk(NODE_DIR);
  walk(join(ROOT, "runtime/c"));

  const napi = ["node_modules/node-api-headers/include", "/tmp/napi-hdrs/node_modules/node-api-headers/include"]
    .map((p) => (p.startsWith("/") ? p : join(ROOT, p)))
    .find((p) => existsSync(join(p, "node_api.h")));

  const defined = new Set();
  const unbuilt = [];
  for (const source of sources) {
    const object = join(RUN_ROOT, `${sources.indexOf(source)}.o`);
    const compile = spawnSync("clang", [
      "-std=c11", "-O0", "-D_GNU_SOURCE", "-fPIC", "-c", source, "-o", object,
      "-I", join(ROOT, "runtime/c"),
      "-I", join(ROOT, "runtime/node/internal"),
      "-I", dirname(source),
      "-I", join(ROOT, "third_party/node/deps/uv/include"),
      ...(napi === undefined ? [] : ["-I", napi]),
    ], { encoding: "utf8" });
    if (compile.status !== 0 || !existsSync(object)) {
      unbuilt.push(source.replace(`${ROOT}/`, ""));
      continue;
    }
    const nm = spawnSync("nm", ["--defined-only", object], { encoding: "utf8" });
    for (const line of `${nm.stdout ?? ""}`.split("\n")) {
      // `<addr> <type> <name>`; a lowercase type is local and not linkable.
      const m = /^\s*\S*\s+([A-Za-z])\s+(\S+)\s*$/.exec(line);
      if (m !== null && m[1] === m[1].toUpperCase()) defined.add(m[2]);
    }
  }
  return { defined, unbuilt };
}

const { defined, unbuilt } = definedSymbols();
if (defined.size === 0) {
  console.log("  INSTRUMENT FAILURE: no object compiled, so no symbol is defined.");
  console.log("  An empty set is not an answer -- every binding would read as missing.");
  process.exit(2);
}

// **`internal` has no `tsconfig.json`, and it is where the whole gap lives.**
// Filtering the module list on a tsconfig -- which every other instrument in
// this directory does, correctly, because a directory without one is not a
// compilation unit -- silently dropped it, and the first run of this file
// reported the native half complete at 0 missing.
//
// A directory of TypeScript that declares bindings is in scope for *this*
// question whether or not it is separately compilable. The filter is on being a
// directory, and `internal` keeps its declarations beside its C rather than
// under `src/`.
const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modules = argv.length > 0
  ? argv
  : readdirSync(NODE_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "node_modules")
    .map((e) => e.name)
    .sort();

let declaredTotal = 0;
let missingTotal = 0;
const rows = [];
for (const module of modules) {
  const src = existsSync(join(NODE_DIR, module, "src"))
    ? join(NODE_DIR, module, "src")
    : join(NODE_DIR, module);
  if (!existsSync(src)) continue;
  const declared = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith(".ts")) continue;
      for (const m of readFileSync(path, "utf8").matchAll(/declare function\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        declared.add(m[1]);
      }
    }
  };
  walk(src);
  if (declared.size === 0) continue;
  const missing = [...declared].filter((name) => !defined.has(name)).sort();
  declaredTotal += declared.size;
  missingTotal += missing.length;
  rows.push({ module, declared: declared.size, missing });
}

rows.sort((a, b) => b.missing.length - a.missing.length);
console.log(`  ${"module".padEnd(22)} declared  missing`);
for (const row of rows) {
  console.log(`  ${row.module.padEnd(22)} ${String(row.declared).padStart(8)}  ${String(row.missing.length).padStart(7)}`);
  for (const name of row.missing.slice(0, 6)) console.log(`      ${name}`);
  if (row.missing.length > 6) console.log(`      … and ${row.missing.length - 6} more`);
}

console.log(`\n  ${declaredTotal} declared binding(s), ${missingTotal} with no C anywhere, ` +
  `across ${rows.length} module(s).`);
if (unbuilt.length > 0) {
  console.log(`  ${unbuilt.length} C file(s) did not compile and contributed no symbols:`);
  for (const f of unbuilt.slice(0, 4)) console.log(`      ${f}`);
  console.log("  Every symbol they would have defined reads as missing above. That is a");
  console.log("  fact about this run, not about the bindings.");
}
console.log("  A missing binding is a link failure waiting for the lowering to arrive,");
console.log("  not one happening now: a module only fails to link once something calls it.");
