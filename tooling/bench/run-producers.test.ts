import assert from "node:assert/strict";
import { test } from "node:test";
import { COLUMNS, COMPARATORS, POLICY, type RunRecord } from "./run-record.ts";
import { fromComparator, fromNts, workloadIdentity, type Metadata } from "./run-producers.ts";
const pin = "a".repeat(40),
  sha = "b".repeat(64);
function meta(): Metadata {
  return {
    schemaVersion: 1,
    id: "2026-10-29-" + pin + "-producer",
    startedAt: null,
    finishedAt: null,
    complete: true,
    inventory: ["a"],
    columns: [...COLUMNS],
    sourceCommit: pin,
    compiler: { commit: pin, sha256: sha },
    harness: { identity: sha, contract: "opaque-bit-input-v1", files: [] },
    machine: { identity: "test", conditions: null },
    comparators: Object.fromEntries(COMPARATORS.map((c) => [c, null])) as RunRecord["comparators"],
    verdictPolicy: POLICY,
    provenance: null,
  };
}
const measurement = { ns_per_op: 100, spread: 1.01, checksum: "4000000000000000" };
function raw() {
  return {
    lanes: null,
    cases: ["a"],
    spoiled: [],
    failed: [],
    measured: [
      {
        shown: "a",
        workload: { seed: 1 },
        source_capture: null,
        results: [measurement, null, null, measurement, null, null],
        absences: {
          outcomes: {
            nts_jvm: {
              kind: "runtime-abort",
              termination: { kind: "exit", code: 1 },
              stderr: "nts: refused: x",
            },
          },
          cpp: "missing gmp",
        },
        node: measurement,
        bun: null,
      },
    ],
  };
}
test("native producer keeps a runtime abort distinct from refusal and absent references", () => {
  const r = fromNts(meta(), raw()).rows[0];
  assert.equal(r.cells["nts JVM"].status, "ABORTED");
  assert.equal(r.cells["C++"].status, "NOT_PROVIDED");
  assert.equal(r.cells["Bun AOT"].status, "NOT_RUN");
  const changed = raw();
  changed.lanes = ["llvm"] as any;
  const filtered = fromNts(meta(), changed).rows[0];
  assert.equal(filtered.cells["nts C"].status, "NOT_RUN");
  assert.equal(filtered.cells["nts JVM"].status, "NOT_RUN");
});
test("checksum mutation invalidates every timing instead of publishing a fast wrong result", () => {
  const r = raw();
  r.measured[0].results[0] = { ...measurement, checksum: "0000000000000000" };
  const row = fromNts(meta(), r).rows[0];
  assert.ok(Object.values(row.cells).every((c) => c.status !== "OK"));
});
test("comparator producer preserves budget termination and rejects unknown statuses", () => {
  const cells = Object.fromEntries(
    COLUMNS.map((c) => [c, { status: "OK", ns: 100, spread: 1, checksum: measurement.checksum }]),
  );
  cells.ScriptC = {
    status: "OVER CPU BUDGET (120 s, SIGXCPU)",
    termination: { signal: "SIGXCPU" },
  } as any;
  assert.equal(
    fromComparator(meta(), [{ name: "a", cells }]).rows[0].cells.ScriptC.status,
    "OVER_BUDGET",
  );
  cells.ScriptC = { status: "mystery" } as any;
  assert.throws(() => fromComparator(meta(), [{ name: "a", cells }]));
});
test("captured identity is order independent, input-bit exact and independent of toolchain libraries", () => {
  const capture = {
    algorithm: "xxh3-128-le-checked-utf8-v1",
    workload: [
      { path: "nts-workspace:///b.ts", digest: "a".repeat(32), rewritten_by: null },
      { path: "nts-workspace:///a.ts", digest: "b".repeat(32), rewritten_by: null },
    ],
    libraries: [{ path: "lib", digest: "c".repeat(32) }],
    drivers: [],
  };
  const identity = workloadIdentity(capture, { seed: -0 });
  assert.equal(
    identity,
    workloadIdentity(
      { ...capture, workload: [...capture.workload].reverse(), libraries: [] },
      { seed: -0 },
    ),
  );
  assert.notEqual(identity, workloadIdentity(capture, { seed: 0 }));
  assert.notEqual(identity, workloadIdentity(capture, { seed: Number.MIN_VALUE }));
  assert.notEqual(
    identity,
    workloadIdentity(
      {
        ...capture,
        workload: [{ ...capture.workload[0], rewritten_by: "transform-v2" }, capture.workload[1]],
      },
      { seed: -0 },
    ),
  );
  assert.equal(workloadIdentity(null, 0), null);
});

test("typed preparation/comparison failures keep their rows and cannot retain accepted timings", () => {
  const preparation = {
    ...raw(),
    row_failures: { a: { kind: "build_failed", reason: "clang failed" } },
    measured: [],
  };
  const row = fromNts(meta(), preparation).rows[0];
  assert.ok(Object.values(row.cells).every((c) => c.status === "BUILD_FAILED"));
  const comparison = { ...raw(), row_failures: { a: { kind: "invalid", reason: "work differs" } } };
  const invalid = fromNts(meta(), comparison).rows[0];
  assert.ok(Object.values(invalid.cells).every((c) => c.status !== "OK"));
  const noOracle = raw();
  noOracle.measured[0].node = null as any;
  const missing = fromNts(meta(), noOracle).rows[0];
  assert.ok(Object.values(missing.cells).every((c) => c.status !== "OK"));
  const orphan = raw();
  orphan.cases = [];
  assert.throws(() => fromNts({ ...meta(), complete: false }, orphan), /orphan/);
});

test("a workload-owned declaration mutation cannot borrow an old own-best", () => {
  const declaration = {
    path: "nts-workspace:///local/config.d.ts",
    digest: "a".repeat(32),
    rewritten_by: null,
  };
  const capture = {
    algorithm: "xxh3-128-le-checked-utf8-v1",
    workload: [declaration],
    declarations: [declaration],
    drivers: [],
  };
  const changed = { ...capture, workload: [{ ...declaration, digest: "b".repeat(32) }] };
  assert.notEqual(workloadIdentity(capture, { seed: 1 }), workloadIdentity(changed, { seed: 1 }));
});
