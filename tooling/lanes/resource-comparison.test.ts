import {test,type TestContext} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync,writeFileSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {beginComparison,resourceStop,readComparisons,pairedResources,digest,gateComparisons,type ComparisonIdentity,type GateComparisons} from "./resource-comparison.ts";

const identity:ComparisonIdentity={suite:"test262",under:"test/staging",backend:"c",record:digest("record"),selection:digest("population"),policy:digest("budget"),compiler:digest("compiler")};
function fixture(t:TestContext){const root=mkdtempSync(join(tmpdir(),"resource-comparison-"));t.after(()=>rmSync(root,{recursive:true,force:true}));return {root,env:{NTS_GATE_STEP_RESULT:join(root,"step.instrument.json"),NTS_GATE_STEP:"step",NTS_GATE_STEP_ATTEMPT:root}};}
const stop={path:"case.js",kind:"memory-cap",phase:"emit"} as const;
test("typed resource buckets qualify; crashes, refusals and suggestive text do not",t=>{
  assert.deepEqual(resourceStop("case.js",{bucket:"memory-cap",why:"emit"}),stop);
  assert.equal(resourceStop("case.js",{bucket:"crash",why:"timeout resident memory cap"}),undefined);
  const {root,env}=fixture(t);
  beginComparison(env).complete(identity,1,[stop]);
  assert.equal(readComparisons(env.NTS_GATE_STEP_RESULT,"step",root)?.resourceOnly,true);
  beginComparison(env).complete({...identity,under:"test/harness"},1,[]);
  assert.equal(readComparisons(env.NTS_GATE_STEP_RESULT,"step",root)?.resourceOnly,false,"a definite failure in another invocation survives");
});
test("pending, malformed, wrong-attempt and duplicate-scope publications hold",t=>{
  const {root,env}=fixture(t),report=beginComparison(env);
  assert.throws(()=>readComparisons(env.NTS_GATE_STEP_RESULT,"step",root),/unfinished/);
  report.complete(identity,1,[stop]);
  assert.throws(()=>readComparisons(env.NTS_GATE_STEP_RESULT,"step","another-run"),/invalid/);
  const path=join(env.NTS_GATE_STEP_RESULT+".comparisons",readdirSync(env.NTS_GATE_STEP_RESULT+".comparisons")[0]);
  const bytes=readFileSync(path,"utf8");writeFileSync(path,"{");
  assert.throws(()=>readComparisons(env.NTS_GATE_STEP_RESULT,"step",root));writeFileSync(path,bytes);
  beginComparison(env).complete(identity,0,[]);
  assert.throws(()=>readComparisons(env.NTS_GATE_STEP_RESULT,"step",root),/duplicate/);
});
test("a missing required report, wrong compiler or contradictory pass holds",t=>{
  const {root,env}=fixture(t),step="test262-rest-cases",owned={...env,NTS_GATE_STEP:step,NTS_GATE_STEP_RESULT:join(root,`${step}.instrument.json`)};
  const summary={environment:{canonical:true,host:{PATH:"tools"},ambient:{TMPDIR:join(root,"tmp")}},requested:[step],steps:[{name:step,verdict:"FAIL"}],identities:{nts:{sha256:identity.compiler}}};
  assert.throws(()=>gateComparisons(root,summary),/missing comparison/);
  beginComparison(owned).complete(identity,1,[stop]);assert.ok(gateComparisons(root,summary).steps[step].evidence?.resourceOnly);
  summary.steps[0].verdict="PASS";assert.throws(()=>gateComparisons(root,summary),/contradicts/);
  summary.steps[0].verdict="FAIL";summary.identities.nts.sha256=digest("other");assert.throws(()=>gateComparisons(root,summary),/another compiler/);
});
for(const [candidate,main,expected] of [[false,true,"candidateRed"],[false,false,"mainRed"],[true,false,"mainRed"],[true,true,"unreproduced"]] as const)test(`paired verdicts ${candidate}/${main} give ${expected}`,t=>{
  const {root,env}=fixture(t);beginComparison(env).complete(identity,1,[stop]);
  const evidence=readComparisons(env.NTS_GATE_STEP_RESULT,"step",root)!;
  const arm=(pass:boolean):GateComparisons=>({host:"same host",requested:["step"],steps:{step:{pass,evidence}}});
  const decision=pairedResources(arm(candidate),arm(main),["step"]);
  assert.deepEqual(decision[expected],["step"]);
  assert.throws(()=>pairedResources(arm(candidate),{...arm(main),host:"other"},["step"]),/host/);
  const changed=structuredClone(arm(main));changed.steps.step.evidence!.reports[0].identity!.policy=digest("different budget");
  assert.throws(()=>pairedResources(arm(candidate),changed,["step"]),/budget/);
  assert.throws(()=>pairedResources(arm(candidate),{...arm(main),requested:["other"]},["step"]),/scope/);
});
