import assert from "node:assert/strict";
import {test} from "node:test";
import {join} from "node:path";
import {fixtureEnvironment} from "../gate/test-environment.ts";
import {readStepInstrument,ToolingInstrumentError} from "../gate/step-result.ts";
import {testScratch} from "../gate/test-scratch.ts";
import type {DecodedCheck} from "../differential/check-report-types.ts";
import {auditRecord} from "../records/record-pending.ts";
import {finishBenchmarks,type RunPlan} from "./run-recording.ts";
import {parseRunRecord,serializeRunRecord,type BenchmarkRun} from "./run-outcomes.ts";

const file="results/benchmarks/jvm/runs.tsv";
const metadata={version:1 as const,backend:"jvm" as const,commit:"a".repeat(40),compiler:"b".repeat(16),under:"benchmarks/cases" as const};
const header='# nts-benchmark-runs '+JSON.stringify(metadata)+'\n';
const entry=(name:string)=>({name,fixture:"benchmarks/cases/"+name});
const check=(outcome:string)=>({outcome,first:"fixture result",report:{refusals:[],disagreements:[],aborts:outcome==="aborted"?["fixture crash"]:[],error:null}}) as unknown as DecodedCheck;

test("an incomplete benchmark leaves its own row pending and publishes completed rows",async t=>{
  const all=[entry("complete"),entry("incomplete")],pending=new Set(all.map(one=>one.fixture));
  const plan:RunPlan={backend:"jvm",file,record:null,pending,recordPending:true};
  const lines:string[]=[],writes:Map<string,BenchmarkRun>[]=[];
  const frame=join(testScratch(t,"benchmark-partial"),"result.json"),step="bench-agree",attempt="fixture-attempt";
  const parentEnv=fixtureEnvironment(t,{NTS_GATE_STEP_RESULT:frame,NTS_GATE_STEP:step,NTS_GATE_STEP_ATTEMPT:attempt});
  const status=await finishBenchmarks(plan,all,
    [{entry:all[0]!,record:check("agrees"),disposition:0}],
    [{entry:all[1]!,error:new ToolingInstrumentError("tooling-setup","stale oracle population")}],
    {binary:"unused-supplied-writer",parentEnv,log:line=>lines.push(line),write:async rows=>{
      const record={metadata,rows:new Map(rows)};
      assert.equal(auditRecord("benchmark-runs",file,null,serializeRunRecord(record),pending).length,1);
      writes.push(new Map(rows));
    }});
  assert.equal(status,124,"the instrument failure remains a hold");
  assert.equal(readStepInstrument(frame,step,attempt)?.kind,"tooling-setup","the parent publishes the incomplete observation after writing completed rows");
  assert.deepEqual(writes.map(rows=>[...rows]),[[[all[0]!.fixture,{kind:"agrees"}]]]);
  assert.ok(lines.some(line=>line.includes("NOT MEASURED incomplete")&&line.includes("stale oracle population")),lines.join("\n"));
  assert.ok(lines.some(line=>line.includes("pending: "+all[1]!.fixture+" is not recorded")),lines.join("\n"));
  assert.ok(lines.some(line=>line.includes("1 not recorded yet")),lines.join("\n"));
});

test("one recorded regression does not discard a new row or an independently accepted update",async t=>{
  const all=[entry("new"),entry("improved"),entry("regressed")];
  const before=header+all.slice(1).map(one=>one.fixture+"\t"+JSON.stringify(one.name==="improved"?{kind:"aborted",failure:"old failure"}:{kind:"agrees"})+"\n").join("");
  const plan:RunPlan={backend:"jvm",file,record:parseRunRecord(before),pending:new Set([all[0]!.fixture]),recordPending:true};
  let written=new Map<string,BenchmarkRun>();
  const lines:string[]=[];
  const status=await finishBenchmarks(plan,all,all.map(one=>({entry:one,record:check(one.name==="regressed"?"aborted":"agrees"),disposition:one.name==="regressed"?1:0})),[],
    {binary:"unused-supplied-writer",parentEnv:fixtureEnvironment(t),log:line=>lines.push(line),write:async rows=>{written=new Map(rows);}});
  assert.equal(status,1,"the regression remains red");
  assert.deepEqual([...written.keys()].sort(),[all[1]!.fixture,all[0]!.fixture].sort());
  assert.equal(written.has(all[2]!.fixture),false,"the worse row is never published");
  assert.ok(lines.includes("not recorded: 1 recorded run(s) changed"),"the regression keeps its consumer summary while other updates publish");
});
