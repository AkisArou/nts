import test from "node:test";
import assert from "node:assert/strict";
import { assessFinding, controlAgrees, parseOracleResult, sameFailure } from "./oracle.ts";
import type { OracleRequest, OracleResult } from "./oracle.ts";
import type { CheckReport } from "../../differential/check-report-types.ts";

function agrees(functions = 1): CheckReport {
  return {
    version: 1, status: "agrees",
    counts: { functions, expected: 3 * functions, compared: 3 * functions, unavailable: 0, runtime_declined: 0,
      timeouts: 0, approximated: 0, disagreements: 0, aborts: 0 },
    oracle: { expected: 3 * functions, received: 3 * functions, complete: true },
    refusals: [], disagreements: [], aborts: [], error: null,
  };
}
function disagrees(functions = 1): CheckReport {
  const report = agrees(functions);
  report.status = "disagrees";
  if (report.counts !== null) report.counts.disagreements = 1;
  report.disagreements = [{ node: "undefined", compiled: "40" }];
  return report;
}
const expectation = "all: count array.get.checked in control == 0";
function request(): OracleRequest {
  return {
    directory: "/unused", source: `// run: check\n// expect-ir: ${expectation}\n`,
    cell: "bounds:call", template: "guarded-read",
    functions: [{ name: "subject", role: "subject" }, { name: "control", role: "control", shortcut: expectation }],
    backends: ["c", "llvm", "jvm"],
  };
}
function result(functions = 2): OracleResult {
  return {
    version: 1, failure: { kind: "wrong-answer", signature: "stale-bounds-read", backends: ["c"] },
    backends: ["c", "llvm", "jvm"].map(backend => ({
      backend, check: backend === "c" ? disagrees(functions) : agrees(functions),
      controls: [{ name: "control", check: agrees(), shortcuts: [{ expectation, status: "pass", use: "present" }] }],
    })),
  };
}

test("oracle admits complete same-program controls and exact shortcut evidence", () => {
  const assessed = assessFinding(request(), result());
  assert.equal(assessed.ok, true);
  if (assessed.ok) assert.deepEqual(assessed.signature, {
    cell: "bounds:call", template: "guarded-read", kind: "wrong-answer", backends: ["c"], oracleSignature: "stale-bounds-read",
  });
});

test("an agrees headline with missing population never proves a control", () => {
  const corruptions: ((report: CheckReport) => void)[] = [
    report => { report.counts = null; },
    report => { report.oracle = null; },
    report => { if (report.oracle !== null) report.oracle.complete = false; },
    report => { if (report.oracle !== null) report.oracle.received = 2; },
    report => { if (report.counts !== null) report.counts.expected = 0; },
    report => { if (report.counts !== null) report.counts.compared = 2; },
    report => { if (report.counts !== null) report.counts.unavailable = 1; },
    report => { if (report.counts !== null) report.counts.runtime_declined = 1; },
    report => { if (report.counts !== null) report.counts.timeouts = 1; },
    report => { if (report.counts !== null) report.counts.approximated = 1; },
    report => { if (report.counts !== null) report.counts.functions = 2; },
    report => { report.refusals.push({ stage: "backend", code: "NTS4001", message: "declined" }); },
  ];
  for (const corrupt of corruptions) {
    const report = agrees();
    corrupt(report);
    assert.equal(controlAgrees(report), false);
    const evidence = result();
    evidence.backends[0].controls[0].check = report;
    assert.equal(assessFinding(request(), evidence).ok, false);
  }
});

test("missing, failed and unresolved shortcuts and deleted expectations reject", () => {
  for (const status of ["fail", "unresolved", "not-measured"]) {
    const evidence = result();
    if (status === "fail" || status === "unresolved" || status === "not-measured") evidence.backends[0].controls[0].shortcuts[0].status = status;
    assert.equal(assessFinding(request(), evidence).ok, false);
  }
  const missing = result();
  missing.backends[1].controls[0].shortcuts = [];
  assert.equal(assessFinding(request(), missing).ok, false);
  const deleted = request();
  deleted.source = "// run: check\n";
  assert.equal(assessFinding(deleted, result()).ok, false);
});

test("a passing zero-count certificate still needs a surviving control use", () => {
  const states: ("missing" | "not-measured")[] = ["missing", "not-measured"];
  for (const use of states) {
    const evidence = result();
    evidence.backends[0].controls[0].shortcuts[0].use = use;
    assert.equal(assessFinding(request(), evidence).ok, false);
  }
  const evidence = result();
  const missingUse = {
    ...evidence, backends: evidence.backends.map(backend => ({
      ...backend, controls: backend.controls.map(control => ({
        ...control, shortcuts: control.shortcuts.map(({ use, ...shortcut }) => shortcut),
      })),
    })),
  };
  assert.equal(assessFinding(request(), missingUse).ok, false);
  assert.throws(() => parseOracleResult(missingUse), /version 1/);
});

test("complete reports for a subset do not cover the whole function inventory", () => {
  const evidence = result(1);
  assert.deepEqual(assessFinding(request(), evidence), { ok: false, reason: "function-coverage:c" });
  const req = request();
  req.functions.push({ name: "subjectTwin", role: "twin", counterpart: "subject" });
  assert.equal(assessFinding(req, result(2)).ok, false);
  assert.equal(assessFinding(req, result(3)).ok, true);
});

test("every backend and every control-derived twin must be measured", () => {
  const req = request();
  req.functions.push({ name: "controlModule", role: "twin", counterpart: "control" });
  assert.equal(assessFinding(req, result()).ok, false);
  const evidence = result(req.functions.length);
  for (const backend of evidence.backends) backend.controls.push({
    name: "controlModule", check: agrees(), shortcuts: [{ expectation, status: "pass", use: "present" }],
  });
  assert.equal(assessFinding(req, evidence).ok, true);
  evidence.backends.pop();
  assert.equal(assessFinding(req, evidence).ok, false);
});

test("partial summaries and failure-kind changes cannot masquerade as the finding", () => {
  const partial = result();
  partial.backends[2].check.status = "partial";
  assert.equal(assessFinding(request(), partial).ok, false);
  const changed = result();
  changed.backends[0].check.status = "error";
  changed.backends[0].check.error = { kind: "emitter", source: null, message: "failed to emit" };
  changed.backends[0].check.counts = null;
  changed.backends[0].check.oracle = null;
  changed.backends[0].check.disagreements = [];
  assert.deepEqual(assessFinding(request(), changed), { ok: false, reason: "failure-kind-mismatch" });
  assert.throws(() => parseOracleResult({ status: "agrees" }), /version 1/);
});

test("malformed CheckReport counts and stage errors fail closed", () => {
  const mismatched = result();
  if (mismatched.backends[0].check.counts !== null) mismatched.backends[0].check.counts.disagreements++;
  assert.equal(assessFinding(request(), mismatched).ok, false);
  const stageError = result();
  stageError.backends[0].check.status = "error";
  stageError.backends[0].check.error = { kind: "emitter", source: null, message: "stage error with invented counts" };
  assert.equal(assessFinding(request(), stageError).ok, false);
  const missingCases = result();
  if (missingCases.backends[0].check.counts !== null) missingCases.backends[0].check.counts.functions = 0;
  assert.equal(assessFinding(request(), missingCases).ok, false);
});

test("an executing control twin needs its own shortcut certificate", () => {
  const twinExpectation = "all: count array.get.checked in controlTwin == 0";
  const req = request();
  req.source += `// expect-ir: ${twinExpectation}\n`;
  req.functions.push({ name: "controlTwin", role: "twin", counterpart: "control", shortcut: twinExpectation });
  const evidence = result(req.functions.length);
  for (const backend of evidence.backends) backend.controls.push({
    name: "controlTwin", check: agrees(), shortcuts: [{ expectation: twinExpectation, status: "pass", use: "present" }],
  });
  assert.equal(assessFinding(req, evidence).ok, true);
  evidence.backends[0].controls[1].shortcuts[0].expectation = expectation;
  assert.equal(assessFinding(req, evidence).ok, false);
  evidence.backends[0].controls[1].shortcuts[0] = { expectation: twinExpectation, status: "fail", use: "present" };
  assert.equal(assessFinding(req, evidence).ok, false);
});

test("shrinking compares source-independent identity and backend sets", () => {
  const left = { cell: "bounds:call", template: "guarded-read", kind: "wrong-answer", backends: ["llvm", "c"], oracleSignature: "read" };
  assert.equal(sameFailure(left, { ...left, backends: ["c", "llvm"] }), true);
  assert.equal(sameFailure(left, { ...left, oracleSignature: "other" }), false);
  assert.equal(sameFailure(left, { ...left, backends: ["c"] }), false);
});
