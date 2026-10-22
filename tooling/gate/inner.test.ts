// The inner loop's decisions: which crates a change touches, when reference
// counting is owed, which runtime C is formatted, and which CPUs heavy work
// may use.
//
//   node --test tooling/gate/inner.test.ts
//
// **The paths below name nothing in this repository on purpose.** The gate
// reads every file a step runs for the paths it names (`owed.mjs`,
// `stepInputs`), and this file is one of the `tooling` step's: a real
// directory written here, `compiler/codegen/c` say, made every change to that
// crate owe the `tooling` step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpusOffMeasurement, cratesTouched, formattedRuntimeC, reachesCounting } from "./inner.ts";

const PACKAGES = [
  { name: "alpha", dir: "compiler/sample-alpha" },
  { name: "alpha-backend", dir: "compiler/sample-alpha/backend" },
  { name: "beta", dir: "tooling/sample-beta" },
];

test("a path belongs to the package whose directory is its longest prefix", () => {
  assert.deepEqual(
    cratesTouched(["compiler/sample-alpha/backend/src/x.rs", "compiler/sample-alpha/src/y.rs"], PACKAGES),
    ["alpha", "alpha-backend"],
  );
});

test("a directory name that only starts like a package's is not in it", () => {
  // `compiler/sample-alpha-extra` is not `compiler/sample-alpha`.
  assert.deepEqual(cratesTouched(["compiler/sample-alpha-extra/lib.rs"], PACKAGES), []);
});

test("a fixture, a doc or a script touches no crate", () => {
  assert.deepEqual(cratesTouched(["tests/sample/src/main.ts", "docs/sample.md"], PACKAGES), []);
});

test("reference counting is owed by the compiler and the runtimes, not by tests alone", () => {
  assert.equal(reachesCounting(["compiler/sample-alpha/src/y.rs"]), true);
  assert.equal(reachesCounting(["runtime/sample.c"]), true);
  assert.equal(reachesCounting(["tests/sample/expected", "tooling/sample-beta/x.ts"]), false);
});

test("heavy work runs everywhere but CPUs 4 and 5", () => {
  assert.equal(cpusOffMeasurement(8), "0,1,2,3,6,7");
  assert.equal(cpusOffMeasurement(4), "0,1,2,3");
});

test("runtime C is formatted at the top level and in tests/, never in a vendored tree", () => {
  assert.deepEqual(
    formattedRuntimeC([
      "runtime/c/sample.c",
      "runtime/c/tests/sample.c",
      "runtime/c/vendored/sample.c",
      "runtime/c/sample.h",
      "runtime/c/sample.md",
    ]),
    ["runtime/c/sample.c", "runtime/c/tests/sample.c", "runtime/c/sample.h"],
  );
});
