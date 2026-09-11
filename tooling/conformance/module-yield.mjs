// What a module would actually turn green, as against how many files carry its name.
//
//   node tooling/conformance/module-yield.mjs
//   node tooling/conformance/module-yield.mjs http2 worker_threads
//
// # Why this exists
//
// The profile's module table counts `test/parallel` files whose *name* begins
// with a module's name, and says so of itself. It was read twice as an estimate
// of what implementing that module would buy, and was wrong by 3x and by 30x:
//
//   tty   "3 tests"   -> 0. One never requires tty, one is excluded as a language
//                        non-goal, one passes already in util's lane, and the two
//                        left reach `internal/test/binding`.
//   dns   "30 tests"  -> 1. Twenty need c-ares, which resolves on the wire and is
//                        not what this profile does; nine of the last ten stub
//                        `cares.getaddrinfo` to make validation deterministic,
//                        which is a substitution and not a read.
//
// Both were answerable with three greps before either module was written. This is
// those greps, over every candidate at once.
//
// # The five dispositions, and why only one of them is a gain
//
//   EXCLUDED      some module's `not-applicable` already names the file, for a
//                 reason independent of this module. Implementing it changes
//                 nothing; the exclusion would still stand.
//   CLAIMED       an existing module's `test-pattern` already matches it, so the
//                 file is in a lane today and counted there. A second module
//                 claiming it would move a number, not earn one.
//   NON-GOAL      it reaches `internalBinding` or `internal/test/binding`. The RFC
//                 rules those out, so no amount of module is enough.
//   NO-REQUIRE    it carries the module's name and never requires it. Whatever it
//                 tests, this module is not what would make it pass. The first run
//                 of this file scored `tty` at 2 without this column, against a
//                 hand-checked 0, and that is what the column is for.
//   BLOCKED       it requires another module that does not exist yet, so it would
//                 still not run. Ordering information, not a loss.
//   ADDRESSABLE   none of the above. This is the number.
//
// # What it does not do
//
// It does not run anything, so ADDRESSABLE is an upper bound on the gain and not
// a prediction: a file that clears all four filters can still fail on the module's
// own behaviour, which is the ordinary work. What it rules out is the opposite
// error -- building a module for files that could never have passed.
//
// Precedence matters and is fixed: EXCLUDED, CLAIMED, NON-GOAL, NO-REQUIRE, then
// BLOCKED. A file can be several of these and is reported as the first, so the
// columns sum to the file count.
//
// # Node does not name its tests after its modules
//
// `worker_threads`'s tests are `test-worker-*`, and the first run of this scored
// it 0 of 0 -- a module with 80 tests reading as though it had none. A zero from
// a pattern that matched nothing looks exactly like a zero from a module nobody
// tests, which is the failure mode `grep -c` has in general. The alias table is
// below and every candidate is checked for an empty match.

import { readdirSync, readFileSync, existsSync } from "node:fs";

const parallel = "third_party/node/test/parallel";
const runtime = "runtime/node";

const implemented = readdirSync(runtime, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(`${runtime}/${e.name}/src/main.ts`))
  .map((e) => e.name);

// Every basename any module has already set aside, with the module that did it.
const excluded = new Map();
for (const m of readdirSync(runtime)) {
  const path = `${runtime}/${m}/not-applicable`;
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Za-z0-9._/-]+\.m?js):/.exec(line.trim());
    if (match) excluded.set(match[1].split("/").pop(), m);
  }
}

// Every basename an existing module's pattern already claims.
const claimed = new Map();
const files = readdirSync(parallel).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
for (const m of readdirSync(runtime)) {
  const path = `${runtime}/${m}/test-pattern`;
  if (!existsSync(path)) continue;
  const re = new RegExp(readFileSync(path, "utf8").trim());
  for (const f of files) if (re.test(f) && !claimed.has(f)) claimed.set(f, m);
}

const candidates = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ["crypto", "tls", "https", "http2", "child_process", "cluster", "worker_threads", "tty", "vm"];

// Where node's test names and node's module names disagree.
const aliases = {
  worker_threads: "worker",
  child_process: "child-process",
  diagnostics_channel: "diagnostics-channel",
  string_decoder: "string-decoder",
  async_hooks: "async-hooks",
};

const requires = (text) => {
  const names = new Set();
  for (const m of text.matchAll(/require\(\s*['"](?:node:)?([a-z_0-9]+)['"]\s*\)/g)) names.add(m[1]);
  for (const m of text.matchAll(/from\s+['"](?:node:)?([a-z_0-9]+)['"]/g)) names.add(m[1]);
  return names;
};

console.log(`  ${files.length} file(s) in test/parallel; ${implemented.length} module(s) implemented\n`);
console.log("   excl  clmd  goal  noreq  blkd  ADDR   total  module");
for (const name of candidates) {
  const re = new RegExp(`^test-${aliases[name] ?? name}(-.*)?\\.(?:js|mjs)$`);
  const mine = files.filter((f) => re.test(f));
  if (mine.length === 0) { console.log(`  ${" ".repeat(29)}  ${name}: no file matched ${re.source}`); continue; }
  const tally = { EXCLUDED: 0, CLAIMED: 0, "NON-GOAL": 0, "NO-REQUIRE": 0, BLOCKED: 0, ADDRESSABLE: [] };
  for (const f of mine) {
    const text = readFileSync(`${parallel}/${f}`, "utf8");
    if (excluded.has(f)) { tally.EXCLUDED++; continue; }
    if (claimed.has(f)) { tally.CLAIMED++; continue; }
    if (/internalBinding|internal\/test\/binding/.test(text)) { tally["NON-GOAL"]++; continue; }
    if (!requires(text).has(name)) { tally["NO-REQUIRE"]++; continue; }
    const needs = [...requires(text)].filter(
      (r) => r !== name && !implemented.includes(r) && candidates.includes(r));
    if (needs.length > 0) { tally.BLOCKED++; continue; }
    tally.ADDRESSABLE.push(f);
  }
  const n = (x) => String(x).padStart(5);
  console.log(`  ${n(tally.EXCLUDED)} ${n(tally.CLAIMED)} ${n(tally["NON-GOAL"])} ${n(tally["NO-REQUIRE"])} ${n(tally.BLOCKED)} ${n(tally.ADDRESSABLE.length)}  ${n(mine.length)}  ${name}`);
}
console.log("\n  ADDRESSABLE is an upper bound: nothing here was executed. It counts");
console.log("  files not already excluded, not already in a lane, not reaching for");
console.log("  internalBinding, and not waiting on another absent module.");
