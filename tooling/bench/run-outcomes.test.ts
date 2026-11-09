// bench-agree's run record (run-outcomes.ts), and its audit by the full
// check's writer (tooling/records/record-pending.ts).
//
//   node --test tooling/bench/run-outcomes.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditRecord } from "../records/record-pending.ts";
import { benchmarkRun, compareBenchmarkRun, mergeRunRecord, parseBenchmarkRun, parseRunRecord, pendingRuns, serializeRunRecord, type BenchmarkRun } from "./run-outcomes.ts";
import type { DecodedCheck } from "../differential/check-report-types.ts";

const header = `# nts-benchmark-runs {"version":1,"backend":"jvm","commit":"${"a".repeat(40)}","compiler":"${"b".repeat(16)}","under":"benchmarks/cases"}\n`;
const line = (name: string, run: BenchmarkRun) => `benchmarks/cases/${name}\t${JSON.stringify(run)}\n`;
const STOP = "timeout";
const aborted: BenchmarkRun = { kind: "aborted", failure: "java.lang.VerifyError: Bad type on operand stack" };

test("one row per benchmark, as the TypeScript records keep them: parsed, written and merged byte for byte", () => {
  const text = header + line("awfy-json", aborted) + line("fib", { kind: "agrees" });
  const record = parseRunRecord(text);
  assert.equal(serializeRunRecord(record), text);
  assert.deepEqual(record.rows.get("benchmarks/cases/awfy-json"), aborted);
  const merged = mergeRunRecord(text, new Map([["benchmarks/cases/clbg", { kind: "timeout", stage: "compile" } as BenchmarkRun]]));
  assert.equal(merged, header + line("awfy-json", aborted) + line("clbg", { kind: "timeout", stage: "compile" }) + line("fib", { kind: "agrees" }));
  for (const bad of [{ kind: "pass" }, { kind: "timeout", stage: "link" }, { kind: "wrong", node: "1", compiled: "1" }, { kind: "aborted" }]) {
    assert.throws(() => parseBenchmarkRun(bad));
  }
  assert.deepEqual(pendingRuns(null, ["benchmarks/cases/b", "benchmarks/cases/a"]), ["benchmarks/cases/a", "benchmarks/cases/b"], "with no record, every benchmark is pending");
  assert.deepEqual(pendingRuns(record, ["benchmarks/cases/awfy-json", "benchmarks/cases/fib", "benchmarks/cases/new"]), ["benchmarks/cases/new"]);
  assert.throws(() => pendingRuns(record, ["benchmarks/cases/fib"]), /recorded benchmark gone missing: benchmarks\/cases\/awfy-json/);
});

test("a check's outcome is the row: agreement, a refusal, a loud defect or a wrong answer", () => {
  const check = (outcome: string, report: object = {}, extra: object = {}) => ({ outcome, first: "first line", report: { refusals: [], disagreements: [], aborts: [], error: null, ...report }, ...extra }) as unknown as DecodedCheck;
  assert.deepEqual(benchmarkRun(check("agrees")), { kind: "agrees" });
  assert.deepEqual(benchmarkRun(check("agrees on what it compared")), { kind: "agrees" });
  assert.deepEqual(benchmarkRun(check("nothing to check")), { kind: "no-scalar-exports" });
  assert.equal(benchmarkRun(check("pending")), null, "no oracle record yet: nothing to record");
  // DecodedCheck's field of that name says which bound the case passed.
  assert.deepEqual(benchmarkRun(check("timed out", {}, { [STOP]: { stage: "run", reason: "x" } })), { kind: "timeout", stage: "run" });
  assert.deepEqual(benchmarkRun(check("disagrees", { disagreements: [{ compiled: "f 1 2", node: "f 1 3" }] })), { kind: "wrong", node: "f 1 3", compiled: "f 1 2" });
  assert.deepEqual(benchmarkRun(check("aborted", { aborts: ['Exception in thread "main" java.lang.VerifyError: Bad type'] })), { kind: "aborted", failure: "java.lang.VerifyError: Bad type" });
  assert.deepEqual(benchmarkRun(check("backend declined", { refusals: [{ stage: "backend", code: "NTS4009", message: "no JVM shape" }] })), { kind: "refused", diagnostic: "NTS4009 no JVM shape" });
  assert.throws(() => benchmarkRun(check("not measured")), /not a recordable run/);
});

test("the shared ratchet: a loud defect that persists reproduces; better is accepted; worse or different is red", () => {
  assert.deepEqual(compareBenchmarkRun(aborted, aborted), { word: "reproduces", ok: true, loud: false });
  assert.equal(compareBenchmarkRun(aborted, { kind: "agrees" }).word, "FIXED");
  assert.equal(compareBenchmarkRun({ kind: "agrees" }, aborted).word, "REGRESSED");
  assert.equal(compareBenchmarkRun({ kind: "wrong", node: "1", compiled: "2" }, aborted).word, "LOUD NOW");
  assert.equal(compareBenchmarkRun(aborted, { kind: "timeout", stage: "run" }).word, "CHANGED", "a different loud defect is a change");
  assert.equal(compareBenchmarkRun(aborted, { kind: "wrong", node: "1", compiled: "2" }).word, "REGRESSED");
  assert.equal(compareBenchmarkRun({ kind: "no-scalar-exports" }, { kind: "agrees" }).word, "CHANGED");
});

test("the full check's writer may start the record from pending rows only, and rewrite only accepted ones", () => {
  const file = "results/benchmarks/jvm/runs.tsv", pending = new Set(["benchmarks/cases/awfy-json", "benchmarks/cases/fib"]);
  const started = header + line("awfy-json", aborted) + line("fib", { kind: "agrees" });
  assert.deepEqual(auditRecord("benchmark-runs", file, null, started, pending).length, 2);
  assert.throws(() => auditRecord("benchmark-runs", file, null, started, new Set(["benchmarks/cases/fib"])), /awfy-json, which was not pending/);
  const fixed = header + line("awfy-json", { kind: "agrees" }) + line("fib", { kind: "agrees" });
  assert.match(auditRecord("benchmark-runs", file, started, fixed, new Set())[0]!, /awfy-json .* \(improved\)$/);
  assert.throws(() => auditRecord("benchmark-runs", file, fixed, started, new Set()), /the ratchet does not accept it/);
});
