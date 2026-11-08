import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {beginComparison,resourceStop,digest,type ComparisonIdentity} from "./resource-comparison.ts";
import {testScratch} from "../gate/test-scratch.ts";

const identity:ComparisonIdentity={suite:"test262",under:"test/staging",backend:"c",record:digest("record"),selection:digest("population"),policy:digest("budget"),compiler:digest("compiler")};
const stop={path:"case.js",kind:"memory-cap",phase:"emit"} as const;
test("typed resource buckets qualify; crashes, refusals and suggestive text do not",()=>{
  assert.deepEqual(resourceStop("case.js",{bucket:"memory-cap",why:"emit"}),stop);
  assert.equal(resourceStop("case.js",{bucket:"crash",why:"timeout resident memory cap"}),undefined);
});
test("comparison publication starts pending and completes its own invocation",t=>{
  const root=testScratch(t,"resource-comparison"),env={NTS_GATE_STEP_RESULT:join(root,"step.instrument.json"),NTS_GATE_STEP:"step",NTS_GATE_STEP_ATTEMPT:root};
  const report=beginComparison(env),directory=env.NTS_GATE_STEP_RESULT+".comparisons",names=readdirSync(directory);
  assert.equal(names.length,1);
  const path=join(directory,names[0]!),pending=JSON.parse(readFileSync(path,"utf8"));
  assert.deepEqual(pending,{version:1,id:pending.id,step:"step",attempt:root,state:"running"});assert.equal(names[0],pending.id+".json");
  report.complete(identity,1,[stop]);
  assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),{...pending,state:"complete",identity,failures:1,resources:[stop]});
  beginComparison(env).complete({...identity,under:"test/harness"},0,[]);
  assert.equal(readdirSync(directory).length,2,"separate invocations keep separate reports");
});
