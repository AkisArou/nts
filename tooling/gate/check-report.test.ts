import type { CheckCounts, CheckReport } from "../differential/check-report-types.ts";
type MeasuredReport = Omit<CheckReport, "status" | "version" | "counts" | "oracle"> & {
  status: string; version: number; counts: CheckCounts; oracle: NonNullable<CheckReport["oracle"]>;
};
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  checkArguments, decodeCheck, formatFromHelp, Outcome, parseJsonReport, projectCheck,
} from "../differential/check-report.ts";

function report(status = "agrees", overrides: Partial<CheckCounts> = {}): MeasuredReport {
  return {
    version: 1, status,
    counts: {
      functions: 1, expected: 2, compared: 2, unavailable: 0,
      runtime_declined: 0, timeouts: 0, approximated: 0, disagreements: 0, aborts: 0,
      ...overrides,
    },
    oracle: { expected: 2, received: 2, complete: true },
    refusals: [], disagreements: [], aborts: [], error: null,
  };
}

test("structured fields decide agreement independently of surrounding prose", () => {
  const value = report("disagrees", { disagreements: 1 });
  value.disagreements.push({ compiled: "f 0 1", node: "f 0 2" });
  const decoded = decodeCheck("json-v1", 1, JSON.stringify(value), "agreed on every case\n");
  assert.equal(decoded.outcome, Outcome.DISAGREES);
  assert.deepEqual(decoded.answers, ["  nts  f 0 1", "  node f 0 2"]);
  assert.throws(() => decodeCheck("json-v1", 0, "checked 2 cases across 1 function(s)\nagreed on every case\n"));
  value.status = "agrees";
  assert.throws(() => decodeCheck("json-v1", 0, JSON.stringify(value)), /contradicts/);
});

test("all unavailable bindings stay separate from a runtime-only total decline", () => {
  const unavailable = report("all_unavailable", { compared: 0, unavailable: 2 });
  const first = decodeCheck("json-v1", 0, JSON.stringify(unavailable));
  assert.equal(first.outcome, Outcome.UNAVAILABLE);
  assert.equal(first.checked, 0);
  assert.equal(first.expected, 2);
  assert.equal(first.unavailable, 2);
  const declined = report("all_declined", { compared: 0, runtime_declined: 2 });
  assert.equal(decodeCheck("json-v1", 1, JSON.stringify(declined)).outcome, Outcome.ALL_DECLINED);
  unavailable.counts.unavailable = 0;
  assert.throws(() => decodeCheck("json-v1", 0, JSON.stringify(unavailable)), /contradicts/);
});

test("a missing population, malformed schema or incomplete oracle fails closed", () => {
  assert.throws(() => decodeCheck("json-v1", 0, ""));
  assert.throws(() => parseJsonReport({}.toString(), 0));
  const value = report();
  const { oracle: _oracle, ...missingOracle } = value;
  assert.throws(() => parseJsonReport(JSON.stringify(missingOracle), 0), /fields/);
  const version = { ...report(), version: 3 };
  assert.throws(() => parseJsonReport(JSON.stringify(version), 0), /version/);
  const incomplete = report();
  incomplete.oracle.received = 1;
  assert.throws(() => parseJsonReport(JSON.stringify(incomplete), 0), /completion/);
  const empty = report("not_measured", { expected: 0, compared: 0 });
  empty.oracle = { expected: 0, received: 0, complete: true };
  assert.throws(() => parseJsonReport(JSON.stringify(empty), 1), /empty population/);
});

test("version two liveness is explicit and complete results retain their record identity", async () => {
  const {runCheck, runConsumer, checkOutcome} = await import('../differential/check-report.ts');
  const complete = report();
  assert.deepEqual(checkOutcome('json-v1', 0, JSON.stringify({...complete,version:2,incomplete:[]})),
    checkOutcome('json-v1', 0, JSON.stringify(complete)));
  for (const kind of ['hung','runaway'] as const) {
    const value = {...report('not_measured',{compared:1,timeouts:1}),version:2,
      incomplete:[{kind,reason:'owned child stopped',case_index:1}]};
    const run = async (_binary: string,args: readonly string[]) => ({status:args[0]==='--help'?0:1,signal:null,
      out:'',stdout:args[0]==='--help'?'  check        compile, run, and compare against node (--json)\n':JSON.stringify(value),stderr:'',elapsedMs:0});
    const held = await runCheck('v2-fixture','project',{run,env:{}});
    assert.equal(held.incomplete?.kind,kind);
    const bad = {...value,incomplete:[{...value.incomplete[0],kind:'unknown'}]};
    assert.throws(()=>parseJsonReport(JSON.stringify(bad),1),/unknown supervisor/);
    value.status='disagrees';value.counts.disagreements=1;
    value.disagreements=[{compiled:'f 0 1',node:'f 0 2'}];
    const red = await runConsumer('v2-fixture','project','program',{run,env:{}});
    assert.equal(red.exitCode,1);assert.equal(red.incomplete,undefined);assert.equal(red.record.report?.incomplete?.[0]?.kind,kind);
    assert.match(red.record.first,/owned child stopped/);
  }
});

test("timeouts and unaccounted calls never become partial agreement", () => {
  const value = report("partial", { compared: 1, runtime_declined: 1 });
  assert.equal(decodeCheck("json-v1", 0, JSON.stringify(value)).outcome, Outcome.PARTIAL);
  value.counts.runtime_declined = 0;
  assert.throws(() => decodeCheck("json-v1", 0, JSON.stringify(value)), /contradicts/);
  value.counts.timeouts = 1;
  assert.throws(() => decodeCheck("json-v1", 0, JSON.stringify(value)), /contradicts/);
  value.status = "not_measured";
  assert.equal(decodeCheck("json-v1", 1, JSON.stringify(value)).outcome, Outcome.NOT_MEASURED);
});

test("failure stages and diagnostic codes determine their own categories", () => {
  const failure: { kind: string; source: string | null; message: string } = {
    kind: "backend_declined", source: null, message: "wording can change",
  };
  const value = {
    version: 1, status: "error", counts: null, oracle: null,
    refusals: [{ stage: "backend", code: "NTS4001", message: "unavailable shape" }],
    disagreements: [], aborts: [],
    error: failure,
  };
  assert.equal(decodeCheck("json-v1", 1, JSON.stringify(value)).outcome, Outcome.BACKEND_DECLINED);
  value.error.kind = "oracle_coverage";
  value.error.source = "benchmarks/cases/example/case.ts";
  const missing = decodeCheck("json-v1", 1, JSON.stringify(value));
  assert.equal(missing.outcome, Outcome.NOT_MEASURED);
  assert.equal(missing.missingPopulation, value.error.source);
  value.error.kind = "made_up";
  assert.throws(() => decodeCheck("json-v1", 1, JSON.stringify(value)), /failure kind/);
});

test("only an old compiler capability chooses legacy text decoding", () => {
  const legacy = "  check        compile, run, and compare against node\n";
  const modern = "  check        compile, run, and compare against node (--json)\n";
  assert.equal(formatFromHelp(0, legacy), "legacy");
  assert.equal(formatFromHelp(0, modern), "json-v1");
  assert.throws(() => formatFromHelp(1, modern), /capability/);
  assert.deepEqual(checkArguments("json-v1", "/project"), ["check", "/project", "--json"]);
  assert.deepEqual(checkArguments("legacy", "/project"), ["check", "/project"]);
  const text = "checked 2 cases across 1 function(s)\nagreed on every case\n";
  assert.equal(decodeCheck("legacy", 0, text).outcome, Outcome.AGREES);
  assert.throws(() => decodeCheck("json-v1", 0, text));
  assert.throws(() => decodeCheck(undefined, 0, text), /explicitly/);
});

test("the decoder CLI rejects an unknown consumer before invoking a compiler", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../differential/check-report.ts", import.meta.url)),
    "consume", "unknown", "/no/compiler/should/be/invoked", "/unused/project"], { encoding: "utf8", env: {...process.env, NTS_GATE_STEP_RESULT: ""} });
  assert.equal(result.status, 124);
  assert.match(result.stderr, /check NOT MEASURED: unknown check consumer/);
});

test("manual instruments use the explicit legacy decoder for old compiler fields", () => {
  const wrong = "checked 1 cases across 1 function(s)\n1 case(s) disagree between the compiled program and node\n" +
    "  nts  work at 0 returned old bits\n  node work at 0 returned other bits\n";
  assert.deepEqual(projectCheck(decodeCheck("legacy", 1, wrong), "compiled-answers"),
    [JSON.stringify("work at 0 returned old bits")]);
  const refused = "  not emitted: main.ts:1:1 NTS4009 old backend reason\nthe backend declined 1 function\n";
  assert.deepEqual(projectCheck(decodeCheck("legacy", 1, refused), "backend-refusals"),
    ["NTS4009 old backend reason"]);
  assert.throws(() => decodeCheck("json-v1", 1, wrong));
  assert.throws(() => decodeCheck("json-v1", 1, refused));
});
