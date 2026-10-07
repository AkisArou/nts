// What owed.mjs maps a changed path to, on this tree:
//
//   node --test tooling/gate/owed.test.mjs
//
// Each case is a path whose reach is known, and the steps it must owe (and,
// where it matters, must not): a mapping that loses one owes too little
// silently, which is the failure owed.mjs exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { allSteps, gateSteps, owed, parseNameStatus } from "./owed.mjs";

const stepsFor = (...paths) => gateSteps(owed(paths.map((path) => ({ path, added: false }))));
const changeOwes = (changes) => gateSteps(owed(changes));
const superset = (got, want, what) => {
  for (const s of want) assert.ok(got.includes(s), `${what} should owe ${s}; owes ${got.join(" ")}`);
};
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
  // A crate's own rule adds to what the crates linking it owe; it never
  // stands in for them.
  owes("compiler/codegen/llvm/src/lib.rs", ["llvm", "llvm-rc", "assembles", "corpus", "bench-agree"]);
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

// ---------------------------------------------------------------------------
// The review of 2026-10-07: each case is a change that owed too little.
// ---------------------------------------------------------------------------

test("the N-API backend owes the addon steps", () => {
  owes("compiler/codegen/napi/src/lib.rs", ["addons", "profile", "divergence"]);
});

test("runtime/c is compiled into the C backend, so it owes at least what the C backend owes", () => {
  const backend = stepsFor("compiler/codegen/c/src/lib.rs");
  superset(stepsFor("runtime/c/nts_runtime.c"), backend, "runtime/c/nts_runtime.c");
  // A new file there, which nothing includes yet, owes the same.
  superset(stepsFor("runtime/c/a-file-nobody-includes-yet.c"), backend, "a new runtime/c file");
});

test("a crate owes its own rule and every rule of the crates that depend on it", () => {
  superset(stepsFor("compiler/semantic-schema/src/lib.rs"), stepsFor("compiler/core/src/lib.rs"), "semantic-schema");
  superset(stepsFor("compiler/core/src/lib.rs"), stepsFor("compiler/codegen/c/src/lib.rs"), "core");
  superset(stepsFor("compiler/memory-lowering/src/lib.rs"), [...stepsFor("compiler/codegen/c/src/lib.rs"), "corpus", "benches", "addons"], "memory-lowering");
  for (const crate of ["compiler/codegen/common", "compiler/debug-lowering", "compiler/jvm-emitter", "build"]) {
    superset(stepsFor(`${crate}/src/lib.rs`), ["corpus", "benches", "bench-agree"], crate);
  }
});

test("a deleted example still owes every step that compiles the examples", () => {
  const got = changeOwes([{ path: "examples/an-example-that-was-removed/src/main.ts", added: false, deleted: true }]);
  superset(got, ["examples", "llvm", "llvm-rc", "jvm", "rc", "integrity", "example-refusals", "dex", "snapshot-cache"], "a deleted example");
});

test("a rename is both paths: a blocker moved out still owes blockers, and moved into examples is a new example", () => {
  const changes = parseNameStatus("R100\ttooling/conformance/blockers/old-fixture/src/main.ts\texamples/old-fixture/src/main.ts\nR100\ttooling/conformance/blockers/old-fixture/tsconfig.json\texamples/old-fixture/tsconfig.json\n");
  assert.deepEqual(changes.map((c) => [c.path, c.added, c.deleted]), [
    ["tooling/conformance/blockers/old-fixture/src/main.ts", false, true],
    ["examples/old-fixture/src/main.ts", true, false],
    ["tooling/conformance/blockers/old-fixture/tsconfig.json", false, true],
    ["examples/old-fixture/tsconfig.json", true, false],
  ]);
  const rules = owed(changes).map((r) => r.name);
  assert.ok(rules.includes("a new example"), rules.join(", "));
  superset(changeOwes(changes), ["blockers", "integrity", "examples", "llvm", "jvm", "rc"], "a renamed blocker");
});

test("the census files a tool runs or reads beside itself owe the test262 steps", () => {
  for (const file of ["tooling/census/attempt262-worker.ts", "tooling/census/harness.ts", "tooling/census/harness-done.ts"]) {
    owes(file, ["test262-cases", "test262-builtins-cases", "test262-rest-cases"]);
  }
});

test("an instrument no step is found to run owes the full gate", () => {
  assert.equal(stepsFor("tooling/conformance/an-instrument-nobody-runs.ts").length, allSteps().length);
});

test("integrity.ts, which blockers-check.mjs spawns, owes blockers", () => {
  owes("tooling/conformance/integrity.ts", ["integrity", "integrity-runtime", "blockers"]);
});

// ---------------------------------------------------------------------------
// Second round of the review.
// ---------------------------------------------------------------------------

test("a step that reads another's output through the runner owes what that step runs", () => {
  // integrity --runtime keeps its listings for definitions and compile-time
  // (run.mjs's NTS_DEFINITIONS_FROM, NTS_COMPILE_TIMES_FROM); profile's
  // emission goes to addons (NTS_ADDON_EMITTED).
  owes("tooling/conformance/integrity.ts", ["integrity-runtime", "definitions", "compile-time"]);
  owes("tooling/census/node-refusals.ts", ["profile", "addons"]);
});

test("an example's nts.config.ts owes config, new or changed, interop's too", () => {
  owes("examples/strings/nts.config.ts", ["config"]);
  superset(changeOwes([{ path: "examples/a-new-one/nts.config.ts", added: true }, { path: "examples/a-new-one/tsconfig.json", added: true }]), ["config"], "a new example with a config");
  owes("examples/interop/gtk-async/nts.config.ts", ["config", "interop"]);
});

test("without cargo, a path in a crate or compiled into one owes the full gate", () => {
  const script = `
    const { allSteps, gateSteps, owed } = await import(${JSON.stringify(new URL("./owed.mjs", import.meta.url).href)});
    const n = (p) => gateSteps(owed([{ path: p, added: false }])).length;
    console.log(JSON.stringify({ all: allSteps().length, rs: n("compiler/core/src/lib.rs"), c: n("runtime/c/nts_runtime.c"), toml: n("compiler/codegen/c/Cargo.toml"), docs: n("docs/primitives.md") }));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, RUSTUP_TOOLCHAIN: "no-such-toolchain-for-this-test" },
  });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.equal(got.rs, got.all);
  assert.equal(got.c, got.all);
  assert.equal(got.toml, got.all);
  assert.ok(got.docs < got.all, "a path no crate holds is not escalated");
});
