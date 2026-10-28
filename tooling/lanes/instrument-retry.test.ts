import { test } from "node:test";
import assert from "node:assert/strict";
import { needsOperatorHold, retryInstruments, type Attempt } from "./instrument-retry.ts";
const pressure={name:"pressure",verdict:"INSTRUMENT",instrument:{kind:"memory-pressure"}};
const attempt = (steps: any[], run = "first"): Attempt => ({ run, status: steps.every(row => row.verdict === "PASS") ? 0 : 1,
  summary: { requested: steps.map(row => row.name), steps, identities: { commit: "frozen", nts: { sha256: "binary" } }, environment: { canonical: true, host: { PATH: "fixed" } }, wall_s: 3 } });
test("pressure retries only missing instruments and preserves real failures and completed evidence", () => {
  const first = attempt([{ name: "pass", verdict: "PASS" }, { name: "bad", verdict: "FAIL" }, pressure, { name: "dependent", verdict: "NOT RUN" }]);
  let held = 0;
  const result = retryInstruments(first, (steps, n) => {
    assert.deepEqual(steps, ["pressure", "dependent"]); assert.equal(n, 2);
    return attempt(steps.map(name => ({ name, verdict: "PASS" })), "second");
  }, rows => { held++; assert.deepEqual(rows.map(row => row.name), ["pressure"]); });
  assert.equal(held, 1); assert.equal(result.summary.verdict, "red");
  assert.deepEqual(result.summary.steps.map(row => row.verdict), ["PASS", "FAIL", "PASS", "PASS"]);
  assert.equal(result.summary.wall_s, 6);
  assert.equal(result.summary.steps[2].evidence_run, "second");
});
test("a named isolated budget failure is never retried or held", () => {
  const first = attempt([{ name: "outcomes", verdict: "FAIL", reason: "case exceeds budget" }]);
  assert.equal(retryInstruments(first, () => assert.fail("no retry"), () => assert.fail("no hold")), first);
});
test("missing summaries and changed host identities cannot release an instrument hold", () => {
  for(const missing of [true,false]) {
    let calls=0,holds=0;
    const first=attempt([pressure]);
    const result=retryInstruments(first,()=>{
      calls++;
      if(missing)return {...first,run:"missing",summary:null as any};
      const next=attempt([{name:"pressure",verdict:"PASS"}],"changed-host");next.summary.environment.host.PATH="different";return next;
    },()=>holds++);
    assert.equal(calls,1);assert.equal(holds,1);assert.equal(result.summary.verdict,"red");
    assert.equal(needsOperatorHold(result.summary.steps[0]),true,"a contradiction cannot retry itself into acceptance");
  }
});
test("a hung or broken tooling instrument leaves completed assertions and stops automatic retries",()=>{
  for(const row of [{name:"tooling",verdict:"NOT RUN",instrument:{kind:"hung"}},{name:"tooling",verdict:"INSTRUMENT",instrument:{kind:"tooling-cleanup"}},{name:"unknown",verdict:"INSTRUMENT"}]) {
    const first=attempt([{name:"real-failure",verdict:"FAIL"},row]);
    assert.equal(retryInstruments(first,()=>assert.fail("no retry"),()=>assert.fail("no memory wait")),first);
  }
});
