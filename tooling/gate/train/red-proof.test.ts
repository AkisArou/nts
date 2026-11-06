import assert from "node:assert/strict";
import { test } from "node:test";
import { definiteFailure, readTrainRedStop } from "./red-stop.ts";

const commit = "a".repeat(40), requested = ["tooling", "tests", "records"];
function fixture(): Record<string, any> {
  return { environment: { canonical: true }, interrupted: null, fail_fast: false, verdict: "red",
    train_red_stop: { version: 1, commit, members: 3, trigger: "tooling", cancelled: ["tests", "records"],
      decided_at: "2026-11-05T22:00:00.000Z", drained_at: "2026-11-05T22:00:01.000Z" },
    steps: [{ name: "tooling", verdict: "FAIL" }, { name: "tests", verdict: "NOT RUN", cancelled_by: "tooling" },
      { name: "records", verdict: "NOT RUN", cancelled_by: "tooling" }] };
}

test("only completed verdict failures can trigger red cancellation", () => {
  assert.equal(definiteFailure({ name: "tooling", verdict: "FAIL" }), true);
  for (const kind of ["tooling-setup", "tooling-cleanup", "selector-setup", "memory-pressure", "hung", "runaway", "unknown"]) {
    assert.equal(definiteFailure({ name: "tooling", verdict: "FAIL", instrument: { kind, verdict: "FAIL" } }), false, kind);
  }
  for (const kind of ["case-budget", "hung", "runaway"]) {
    assert.equal(definiteFailure({ name: "tooling", verdict: "FAIL", instrument: { kind, verdict: "FAIL", completedFailures: 1 } }), true, kind);
  }
  assert.equal(definiteFailure({ name: "tooling", verdict: "FAIL", cancelled_by: "tests" }), false);
  assert.equal(definiteFailure({ name: "tooling", verdict: "INSTRUMENT" }), false);
  assert.equal(definiteFailure({ name: "tooling", verdict: "FAIL", signal: "SIGKILL", exit: null }), false);
  assert.equal(definiteFailure({ name: "tooling", verdict: "FAIL", exit: 137 }), false);
});

test("closed cancellation proof covers exactly the deliberately unfinished rows", () => {
  assert.equal(readTrainRedStop(fixture(), commit, 3, requested)?.trigger, "tooling");
  const complete = fixture(); delete complete.train_red_stop;
  complete.steps = requested.map(name => ({ name, verdict: "PASS" }));
  assert.equal(readTrainRedStop(complete, commit, 3, requested), undefined);
  complete.steps[0].verdict = "FAIL";
  assert.equal(readTrainRedStop(complete, commit, 1, requested), undefined, "single-member complete collection needs no early-red proof");
  assert.throws(() => readTrainRedStop(complete, commit, 3, requested), /missing/);
});

const corruptions: [string, (summary: Record<string, any>) => void][] = [
  ["missing proof", s => { delete s.train_red_stop; }],
  ["unknown field", s => { s.train_red_stop.extra = true; }],
  ["foreign commit", s => { s.train_red_stop.commit = "b".repeat(40); }],
  ["foreign membership", s => { s.train_red_stop.members = 2; }],
  ["operator interruption", s => { s.interrupted = "signal SIGTERM"; }],
  ["inner-loop fail-fast", s => { s.fail_fast = true; }],
  ["noncanonical", s => { s.environment.canonical = false; }],
  ["hold trigger", s => { s.steps[0].instrument = { kind: "tooling-setup", verdict: "INSTRUMENT" }; }],
  ["signalled trigger", s => { s.steps[0].signal = "SIGKILL"; }],
  ["abnormal exit trigger", s => { s.steps[0].exit = 137; }],
  ["unknown disposition", s => { s.steps[1].verdict = "unknown"; }],
  ["cancelled pass", s => { s.steps[1].verdict = "PASS"; }],
  ["cancelled instrument", s => { s.steps[1].instrument = { kind: "memory-pressure" }; }],
  ["foreign cancellation signal", s => { s.steps[1].started_at = "2026-11-05T22:00:00.000Z"; s.steps[1].signal = "SIGSEGV"; }],
  ["unlisted cancellation", s => { s.train_red_stop.cancelled.pop(); }],
  ["invented cancellation", s => { s.train_red_stop.cancelled.push("build"); }],
  ["duplicate cancellation", s => { s.train_red_stop.cancelled.push("tests"); }],
  ["unproved unfinished", s => { delete s.steps[1].cancelled_by; s.train_red_stop.cancelled.shift(); }],
  ["wrong trigger", s => { s.train_red_stop.trigger = "tests"; }],
  ["missing row", s => { s.steps.pop(); }],
  ["duplicate row", s => { s.steps[2] = s.steps[1]; }],
  ["foreign row", s => { s.steps[2].name = "foreign"; }],
  ["reversed phase time", s => { s.train_red_stop.drained_at = "2026-11-05T21:59:59.000Z"; }],
];

for (const fault of ["populated", "foreign-group"]) test(`modern scope execution refuses ${fault} drain evidence`, () => {
  const summary = fixture(), slice = `nts-tooling-${"a".repeat(32)}.slice`, group = `/owned/${slice}`;
  summary.scope_execution = true;
  summary.scope_root = { slice, group };
  summary.scope_cleanup = { state: "complete" };
  summary.steps.forEach((row: Record<string, any>, index: number) => {
    const own = `${slice.slice(0, -6)}-run${String(index).repeat(32)}.slice`;
    row.started_at = "2026-11-05T22:00:00.000Z";
    if (index) row.signal = "SIGKILL";
    row.scope = { version: 1, slice: own, unit: `${own.slice(0, -6)}-step.scope`, group: `${group}/${own}`,
      device: "1", inode: String(index + 1), populated: 0, observed_at: "2026-11-05T22:00:01.000Z" };
    row.scope_entry = { version: 1, nonce: "a".repeat(36), unit: row.scope.unit, group: `${row.scope.group}/${row.scope.unit}` };
  });
  assert.equal(readTrainRedStop(summary, commit, 3, requested)?.trigger, "tooling");
  if (fault === "populated") summary.steps[0].scope.populated = 1;
  else summary.steps[0].scope.group = `/foreign/${summary.steps[0].scope.slice}`;
  assert.throws(() => readTrainRedStop(summary, commit, 3, requested), /drain is not proved/);
});
for (const [name, corrupt] of corruptions) test(`red-stop reader holds ${name}`, () => {
  const summary = fixture(); corrupt(summary);
  assert.throws(() => readTrainRedStop(summary, commit, 3, requested));
});
