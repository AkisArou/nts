// What owed.mjs maps a changed path to, on this tree:
//
//   node --test tooling/gate/owed.test.mjs
//
// Each case is a path whose reach is known, and the steps it must owe (and,
// where it matters, must not): a mapping that loses one owes too little
// silently, which is the failure owed.mjs exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allSteps, gateSteps, owed } from "./owed.mjs";

const stepsFor = (...paths) => gateSteps(owed(paths.map((path) => ({ path, added: false }))));
const full = () => stepsFor("no/rule/matches/this.txt");

function owes(path, want, { not = [] } = {}) {
  const got = stepsFor(path);
  // Owing everything would satisfy any `want`: these are claims of reach.
  assert.ok(got.length < allSteps().length, `${path} owes the full gate, so this case shows nothing about its reach`);
  for (const s of want) assert.ok(got.includes(s), `${path} should owe ${s}; owes ${got.join(" ")}`);
  for (const s of not) assert.ok(!got.includes(s), `${path} should not owe ${s}; owes ${got.join(" ")}`);
  return got;
}

test("a path no rule names owes the full gate", () => {
  assert.deepEqual([...full()].sort(), [...allSteps()].sort());
  assert.equal(stepsFor("Cargo.lock").length, allSteps().length);
});

test("the runner owes the full gate", () => {
  for (const p of ["tooling/gate/all.sh", "tooling/gate/run.mjs", "tooling/gate/token.sh", "tooling/gate/tokenpool.mjs", "tooling/gate/pinned.sh"]) {
    assert.equal(stepsFor(p).length, allSteps().length, p);
  }
});

test("an input of a corpus's tsconfig owes that corpus's steps", () => {
  // Named by three blockers fixtures' `files`, not by any rule.
  owes("runtime/chromium/dom/types/dom-idl.d.ts", ["blockers", "integrity"], { not: ["interop", "definitions"] });
  // Extended by every fixture config.
  owes("tsconfig.fixtures.json", ["examples", "blockers", "memory", "bench-agree"]);
  owes("tooling/memory/cases/closure-capture/src/main.ts", ["memory"], { not: ["examples"] });
});

test("a crate no rule names owes what the crates that use it owe", () => {
  // memory-lowering has no rule; codegen-c and codegen-llvm depend on it.
  owes("compiler/memory-lowering/src/lib.rs", ["examples", "rc", "llvm", "llvm-rc"]);
  // A crate with a rule keeps its rule's reach: the LLVM backend owes the
  // LLVM steps, not everything the CLI linking it owes.
  assert.deepEqual(stepsFor("compiler/codegen/llvm/src/lib.rs"), ["build", "clippy", "tests", "llvm", "llvm-rc", "assembles"]);
  // semantic-schema has its own rule (the frontend and the snapshot schema).
  owes("compiler/semantic-schema/src/lib.rs", ["snapshot-cache", "types", "test262-cases"]);
});

test("what a step runs owes that step", () => {
  owes("tooling/conformance/integrity.ts", ["integrity", "integrity-runtime"], { not: ["examples"] });
  owes("tooling/gate/costs.mjs", ["integrity-runtime", "snapshot-cache", "assembles", "jvm-verifies", "types"]);
  // Run by llvm, llvm-rc and jvm through all.sh's backend_examples.
  owes("tooling/differential/agree.mjs", ["llvm", "llvm-rc", "jvm"]);
  owes("tooling/android/dexes.sh", ["dex"]);
  owes("tooling/gate/definitions", ["definitions"]);
  owes("tooling/census/test262-language.outcomes.tsv", ["test262-cases"]);
  owes("tooling/gate/compile-times.tsv", ["compile-time"]);
});

test("a data file a step's tool reads beside itself owes that step", () => {
  owes("tooling/gate/compile-times.tsv", ["compile-time"], { not: ["examples"] });
  owes("tooling/conformance/integrity.known", ["integrity", "integrity-runtime"]);
  assert.ok(stepsFor("tooling/gate/times.tsv").length < allSteps().length);
});

test("documentation owes its two readers, not the gate", () => {
  owes("docs/primitives.md", ["primitives", "records"], { not: ["examples", "interop"] });
});

test("the hand-written rules still decide what they name", () => {
  owes("examples/strings/src/main.ts", ["examples", "llvm", "llvm-rc", "jvm", "rc"]);
  owes("runtime/c/nts_runtime.h", ["tests", "bench-agree", "format"]);
  owes("compiler/core/src/hir/lower.rs", ["test262-cases", "jvm-verifies", "benches"]);
  owes("runtime/node/path/index.ts", ["definitions", "integrity-runtime", "addons", "compile-time"]);
});

test("every step the rules can owe exists", () => {
  const all = new Set(allSteps());
  for (const p of ["compiler/core/src/lib.rs", "runtime/node/fs/index.ts", "tsconfig.fixtures.json", "tooling/gate/costs.mjs"]) {
    for (const s of stepsFor(p)) assert.ok(all.has(s), `${p} owes ${s}, which all.sh does not define`);
  }
});
