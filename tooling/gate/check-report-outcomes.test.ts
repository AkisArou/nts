import type { CheckCounts, CheckReport } from "../differential/check-report-types.ts";
type MeasuredReport = Omit<CheckReport, "status" | "version" | "counts" | "oracle"> & {
  status: string; version: number; counts: CheckCounts; oracle: NonNullable<CheckReport["oracle"]>;
};
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync,readdirSync} from "node:fs";
import { checkOutcome, sameCheckOutcome, validateStoredCheckOutcome } from "../differential/check-report.ts";

function report(status = "agrees", changes: Partial<CheckCounts> = {}): MeasuredReport {
  return {
    version: 1, status,
    counts: { functions: 1, expected: 2, compared: 2, unavailable: 0,
      runtime_declined: 0, timeouts: 0, approximated: 0, disagreements: 0, aborts: 0,
      ...changes },
    oracle: { expected: 2, received: 2, complete: true },
    refusals: [], disagreements: [], aborts: [], error: null,
  };
}

const observe = (value: unknown, status = 0) => checkOutcome("json-v1", status, JSON.stringify(value), "agreed on every case\n");

test("outcome categories read structured findings and reject text test doubles", () => {
  const wrong = report("disagrees", { disagreements: 1 });
  wrong.disagreements.push({ compiled: "f 0 1", node: "f 0 2" });
  assert.equal(observe(wrong, 1).category, "wrong-answer");
  wrong.counts.disagreements = 0;
  assert.throws(() => observe(wrong, 1), /count changed/);
  assert.throws(() => checkOutcome("json-v1", 0, "checked 2 cases across 1 function(s)\nagreed on every case\n"));
  assert.equal(observe(report()).category, "agrees");
});

test("unavailable, runtime declines and hang bounds have distinct outcome meanings", () => {
  const unavailable = report("all_unavailable", { compared: 0, unavailable: 2 });
  unavailable.refusals.push({ stage: "lowering", code: "NTS1001", message: "unsupported body" });
  assert.equal(observe(unavailable).category, "refused");
  const declined = report("all_declined", { compared: 0, runtime_declined: 2 });
  assert.equal(observe(declined, 1).category, "aborted");
  const timeout = report("not_measured", { compared: 0, timeouts: 2 });
  assert.equal(observe(timeout, 1).category, "not-measured");
});

test("new outcome identities preserve fields independently of displayed prose", () => {
  const now = observe(report());
  const was = { version: 1, check: now.check, nts: "unrelated display text" };
  assert.ok(sameCheckOutcome(was, now));
  const changed = report("disagrees", { disagreements: 1 });
  changed.disagreements.push({ compiled: "f 0 1", node: "f 0 2" });
  assert.equal(sameCheckOutcome(was, observe(changed, 1)), false);
  assert.throws(() => sameCheckOutcome({ ...was, version: 2 }, now), /version/);
  assert.throws(() => sameCheckOutcome(was, { nts: was.nts }), /structured observation/);
});

test("only a version-zero stored record uses its original summary coverage", () => {
  const was = { run: "check", category: "wrong-answer",
    nts: "checked 2 cases across 1 function(s) | Error: 1 case(s) disagree between the compiled program and node" };
  const value = report("disagrees", { disagreements: 1 });
  value.disagreements.push({ compiled: "f 0 1", node: "f 0 2" });
  assert.ok(sameCheckOutcome(was, observe(value, 1)));
  value.counts.expected = 3;
  value.oracle = { expected: 3, received: 3, complete: true };
  assert.equal(sameCheckOutcome(was, observe(value, 1)), false);
  assert.throws(() => sameCheckOutcome({ ...was, version: 1 }, observe(value, 1)), /structured/);
});

test("validator and refusal numbering use the shared identity normalizer", () => {
  const invalid = (name: string) => observe({ version: 1, status: "error", counts: null, oracle: null,
    refusals: [], disagreements: [], aborts: [],
    error: { kind: "preparation", source: null, message: `invalid HIR: ${name} at main.ts:7:3, type 35, FunctionId(81)` } }, 1);
  const before = invalid("Cell<35>#read");
  assert.ok(sameCheckOutcome({ version: 1, check: before.check }, invalid("Cell<93>#read")));
  assert.equal(sameCheckOutcome({ version: 1, check: before.check }, invalid("Tuple<93>#read")), false);
  assert.ok(sameCheckOutcome({ category: "invalid-hir", nts: "invalid HIR: Cell<11>#read at main.ts:7:3, type 9, FunctionId(2)" }, before));
  const refused = report("all_unavailable", { compared: 0, unavailable: 2 });
  refused.refusals.push({ stage: "lowering", code: "NTS1001", message: "Cell<35>#read is unavailable" });
  const previous = observe(refused);
  refused.refusals[0].message = "Cell<93>#read is unavailable";
  assert.ok(sameCheckOutcome({ version: 1, check: previous.check }, observe(refused)));
});

test("JVM host failures keep their class and normalized first message while answers stay exact", () => {
  const value = report("aborted", { compared: 1, runtime_declined: 1, aborts: 1 });
  value.aborts.push('Exception in thread "main" java.lang.ClassCastException: nts.gen.Cell$35$ cannot be cast to class nts.gen.Type93\n\tat generated.frame:1');
  const before = observe(value, 1);
  value.aborts[0] = 'Exception in thread "worker" java.lang.ClassCastException: nts.gen.Cell$81$ cannot be cast to class nts.gen.Type14\n\tat different.frame:50';
  assert.ok(sameCheckOutcome({ version: 1, check: before.check }, observe(value, 1)));
  value.aborts[0] = value.aborts[0].replace("Cell", "Tuple");
  assert.equal(sameCheckOutcome({ version: 1, check: before.check }, observe(value, 1)), false);
  const wrong = report("disagrees", { disagreements: 1 });
  wrong.disagreements.push({ compiled: "Cell<35> type 9", node: "answer" });
  const answer = observe(wrong, 1);
  wrong.disagreements[0].compiled = "Cell<93> type 12";
  assert.equal(sameCheckOutcome({ version: 1, check: answer.check }, observe(wrong, 1)), false);
});

test("every stored check outcome is accepted by its explicitly versioned reader", () => {
  const root=new URL("../../tests/outcomes/",import.meta.url);let checked=0;
  for(const name of readdirSync(root)) {
    const record=JSON.parse(readFileSync(new URL(name+"/outcome.json",root),"utf8"));
    if(record.run!=="check")continue;
    assert.doesNotThrow(()=>validateStoredCheckOutcome(record),name);checked++;
  }
  assert.ok(checked>0,"the stored check inventory was actually read");
  assert.throws(()=>validateStoredCheckOutcome({category:"agrees",nts:"checked 1 cases across 1 function(s) | unknown future clause"}),/legacy/);
});

test("legacy joined diagnostics keep union text inside the same refusal", () => {
  const value=report("partial",{compared:1,unavailable:1});
  value.refusals=[{stage:"lowering",code:"NTS1001",message:"an array of number | null is unsupported"}];
  const was={category:"agrees",nts:"checked 1 of 2 cases; the rest were not reached (a pool value in a loop bound will do that) | agreed on every case it compared: 1 of 2 | refused: NTS1001 an array of number | null is unsupported"};
  assert.ok(sameCheckOutcome(was,observe(value)));
  value.refusals[0].message="an array of number | undefined is unsupported";
  assert.equal(sameCheckOutcome(was,observe(value)),false);
});
