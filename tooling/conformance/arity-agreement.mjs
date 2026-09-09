// Does a published function's `length` agree with the arity it demands?
//
//   NTS_ADDON_OUT=<a private directory> node tooling/conformance/arity-agreement.mjs
//   NTS_ADDON_OUT=<...> node tooling/conformance/arity-agreement.mjs async_hooks fs
//
// # Why this is read out of the C rather than measured by calling
//
// `unusable-exports.mjs` answers the same question by calling each function
// with `new Array(f.length).fill(undefined)` and reading the thrown message.
// That works, and it **cannot ask about ten of the twenty-two modules**: `fs`
// touches the filesystem, `net` binds sockets, `process` can end the process,
// and seven more are skipped for the same kind of reason. Two of the four
// disagreements found on 2026-09-09 were in skipped modules and were found by
// hand.
//
// The wrapper writes both numbers into `addon.c`, so both can be read without
// running anything:
//
//     napi_create_function(env, "emitBefore", NAPI_AUTO_LENGTH,
//                          nts_napi_emitBefore, NULL, &fn)
//     nts_napi_set_length(env, fn, 3u);
//
//     static napi_value nts_napi_emitBefore(napi_env env, napi_callback_info info) {
//         ...
//         if (argc < 4) { napi_throw_type_error(env, "ERR_MISSING_ARGS",
//             "the compiled function requires 4 arguments");
//
// `length` 3, demands 4. A caller doing exactly what the function says still
// fails, which is the only reason this question is worth asking at all.
//
// # What it depends on, said plainly
//
// It reads emitted C by pattern, so a change to how the wrapper is written
// makes it report nothing rather than something wrong -- and nothing is a
// result this file is not entitled to print quietly. It says how many functions
// it found per module, and a module whose count is zero while its addon exists
// is reported as a parse failure and not as agreement.
//
// It also cannot see a disagreement that is not written down: a wrapper that
// reads arguments without an `argc` check has no demanded number, and this
// reports it as agreeing because there is nothing to disagree with.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node");

const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modules = argv.length > 0
  ? argv
  : readdirSync(join(ROOT, "runtime/node"))
    .filter((m) => m !== "node_modules" && existsSync(join(ROOT, "runtime/node", m, "tsconfig.json")))
    .sort();

let checkedModules = 0;
let functions = 0;
let disagreeing = 0;
const unreadable = [];
const publishesNoFunctions = [];

for (const module of modules) {
  const addon = join(ADDON_DIR, `${module}.build`, "addon.c");
  if (!existsSync(addon)) continue;
  const source = readFileSync(addon, "utf8");

  // Every wrapper's demanded count, by symbol. The message is the wrapper's
  // own, so the number is read from the same place the caller would meet it.
  const demanded = new Map();
  const bodies = source.matchAll(
    /static napi_value (nts_napi_[A-Za-z0-9_]+)\(napi_env[^]*?\n\}/g,
  );
  for (const body of bodies) {
    const found = /the compiled function requires (\d+) argument/.exec(body[0]) ??
      /the constructor requires (\d+) argument/.exec(body[0]);
    if (found !== null) demanded.set(body[1], Number(found[1]));
  }

  // Every publish block: the name node sees, the wrapper behind it, the length.
  const rows = [];
  const publishes = source.matchAll(
    /napi_create_function\(env, "([^"]+)", NAPI_AUTO_LENGTH, (nts_napi_[A-Za-z0-9_]+),[^;]*;\s*\n\s*nts_napi_set_length\(env, fn, (\d+)u\);/g,
  );
  for (const publish of publishes) {
    const [, name, symbol, length] = publish;
    rows.push({ name, symbol, length: Number(length), demands: demanded.get(symbol) ?? null });
  }

  // **A class is published a different way and was missed entirely.**
  // `napi_define_class(env, "Stats", NAPI_AUTO_LENGTH, nts_napi_new_NtsObj_Stats, ...)`
  // carries no `nts_napi_set_length` call at all, so the constructor's `length`
  // is 0 while its body demands 1. Reading only `napi_create_function` reported
  // `fs` as agreeing, and `fs` has the one constructor in the tree.
  //
  // The `NAPI_AUTO_LENGTH` in that call is the **name's** length, not the
  // function's -- the same confusion that left every published function at
  // `length` 0 before the wrapper started setting it.
  const classes = source.matchAll(
    /napi_define_class\(env, "([^"]+)", NAPI_AUTO_LENGTH, (nts_napi_[A-Za-z0-9_]+),/g,
  );
  for (const found of classes) {
    const [, name, symbol] = found;
    rows.push({ name, symbol, length: 0, demands: demanded.get(symbol) ?? null, isClass: true });
  }

  if (rows.length === 0) {
    // **A module publishing no functions is not a parse failure**, and calling
    // it one turned six honest rows into six alarms on the first run.
    // `string_decoder` publishes nothing at all; `zlib` publishes two names and
    // neither is a function. The distinction is whether the emitted C creates
    // any function at all: if it does and this could not read the pair, the
    // pattern has drifted and the silence is this file's fault.
    if (/napi_create_function\(/.test(source)) unreadable.push(module);
    else publishesNoFunctions.push(module);
    continue;
  }
  checkedModules += 1;
  functions += rows.length;
  const bad = rows.filter((r) => r.demands !== null && r.demands > r.length);
  disagreeing += bad.length;
  if (bad.length === 0) continue;
  console.log(`  ${module}: ${rows.length} published function(s), ${bad.length} disagreeing`);
  for (const row of bad) {
    console.log(`      ARITY  ${row.name}  length ${row.length}, demands ${row.demands}`);
  }
}

for (const module of unreadable) {
  console.log(`  PARSE FAILED    ${module}: creates functions, and no publish block this could read`);
  console.log("                  Not agreement. The emitted form has drifted from what this matches.");
}
if (publishesNoFunctions.length > 0) {
  console.log(`  ${publishesNoFunctions.length} module(s) publish no function at all: ` +
    `${publishesNoFunctions.join(", ")}.`);
  console.log("  Nothing to disagree about, which is a fact about those modules and not a pass.");
}

console.log(
  `\n  ${functions} published function(s) across ${checkedModules} module(s), ` +
  `${disagreeing} whose length disagrees with the arity they demand.`,
);
if (unreadable.length > 0) {
  console.log(`  ${unreadable.length} module(s) could not be read and are counted in neither figure.`);
}
console.log("  A disagreement is the one case where a caller doing exactly what the");
console.log("  function's own `length` says still fails. Read from the emitted C, so");
console.log("  it covers the modules that cannot be called.");
