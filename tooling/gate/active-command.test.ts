import assert from "node:assert/strict";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {activeCommand,processActivity,CommandActivitySampler} from "./active-command.ts";
import {readStepInstrument} from "./step-result.ts";
import {waitFor} from "./test-wait.ts";

function fixture(t) {
  const base=join(homedir(),".cache/nts-active-command-tests");mkdirSync(base,{recursive:true});
  const root=mkdtempSync(join(base,"case-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  return {root,env:{...process.env,NTS_GATE_STEP:"c-compiles",NTS_GATE_STEP_ATTEMPT:"active-control",NTS_GATE_STEP_RESULT:join(root,"result.json")}};
}

test("process activity parses group identity and all user/sys CPU including reaped children",()=>{
  const fields=Array(20).fill("0");fields[0]="S";
  for(const [at,value] of [[2,41],[3,41],[11,5],[12,7],[13,11],[14,13],[19,123]])fields[at]=String(value);
  assert.deepEqual(processActivity(`41 (a name with ) in it) ${fields.join(" ")}`),{group:41,session:41,cpu:36,started:123});
  assert.throws(()=>processActivity("unreadable"),/invalid/);
});

test("one activity snapshot serves concurrent groups without sharing their progress",()=>{
  let scans=0;
  const records=new Map([
    [41,{group:41,session:41,cpu:10,started:100}],
    [42,{group:41,session:41,cpu:7,started:101}],
    [51,{group:51,session:51,cpu:0,started:200}],
  ]);
  const sampler=new CommandActivitySampler(owned=>{scans++;assert.deepEqual([...owned],[41,51]);return records;});
  const observed:number[][]=[[],[]],errors:unknown[]=[];
  const cancel=[41,51].map((group,index)=>sampler.watch({group,started:group===41?100:200,pollMs:5000,sample:cpu=>observed[index].push(cpu),broken:error=>errors.push(error)}));
  try{
    sampler.sample();records.get(42)!.cpu+=10;sampler.sample();
    assert.equal(scans,2);assert.deepEqual(observed,[[17,27],[0,0]]);assert.deepEqual(errors,[]);
    records.get(41)!.started++;
    sampler.sample();assert.equal(errors.length,1);assert.match(String(errors[0]),/identity changed/);
    assert.deepEqual(observed,[[17,27],[0,0,0]]);
  }finally{cancel.forEach(stop=>stop());}
});

test("structured stdout stays separate while command diagnostics are retained",async t=>{
  const {root,env}=fixture(t);
  const result=await activeCommand(process.execPath,["-e","process.stderr.write('diagnostic\\n');process.stdout.write(JSON.stringify({value:7}));"],{cwd:root,env});
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{value:7});assert.equal(result.stderr,"diagnostic\n");assert.ok(result.out.includes("diagnostic\n"));assert.ok(result.out.includes(result.stdout));
});

test("capture budgets hold and multibyte output remains exact across pipe chunks",async t=>{
  const {root,env}=fixture(t);
  const text="λ😃z".repeat(100_000);
  const result=await activeCommand(process.execPath,["-e","process.stdout.write('λ😃z'.repeat(100000));process.stderr.write('終');"],{cwd:root,env,maxBuffer:1024*1024});
  assert.equal(result.status,0);assert.equal(result.stdout,text);assert.equal(result.stderr,"終");
  const separate=await activeCommand(process.execPath,["-e","process.stdout.write('x'.repeat(1000));process.stderr.write('y'.repeat(1000));"],{cwd:root,env,maxBuffer:1024});
  assert.equal(separate.status,0);assert.equal(separate.stdout.length,1000);assert.equal(separate.stderr.length,1000);
  await assert.rejects(activeCommand(process.execPath,["-e","process.stdout.write('x'.repeat(4096));"],{cwd:root,env,maxBuffer:1024}),/capture budget/);
  await assert.rejects(activeCommand(process.execPath,["-e","process.stdout.write('{\"status\":\"agrees\"}');process.stderr.write('😃'.repeat(300));"],{cwd:root,env,maxBuffer:1024}),/stderr.*capture budget/);
  const frame=readStepInstrument(env.NTS_GATE_STEP_RESULT,env.NTS_GATE_STEP,env.NTS_GATE_STEP_ATTEMPT);
  assert.equal(frame?.kind,"tooling-setup");assert.equal(frame?.verdict,"INSTRUMENT");
});

test("CPU-busy work remains live without output beyond the idle guard",async t=>{
  const {root,env}=fixture(t),release=join(root,"release");
  const result=await activeCommand(process.execPath,["-e",`const fs=require('node:fs');while(!fs.existsSync(process.argv[1])){};process.stdout.write('complete\\n');`,release],{
    cwd:root,env,idleMs:2000,pollMs:50,onActivity:event=>{if(event.elapsedMs>4000)writeFileSync(release,"release\n");},
  });
  assert.equal(result.status,0,result.out);assert.equal(result.out,"complete\n");assert.equal(result.hung,undefined);
  assert.ok(result.elapsedMs>2000);assert.equal(existsSync(env.NTS_GATE_STEP_RESULT),false);
});

test("an idle command is typed NOT RUN hung while completed exits keep their meaning",async t=>{
  const {root,env}=fixture(t);
  const idle=await activeCommand(process.execPath,["-e","Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)"],{cwd:root,env,idleMs:2000,pollMs:50});
  assert.match(idle.hung!,/no output or process-group CPU activity/);
  const frame=readStepInstrument(env.NTS_GATE_STEP_RESULT,"c-compiles","active-control");
  assert.equal(frame?.verdict,"NOT RUN");assert.equal(frame?.kind,"hung");
  rmSync(env.NTS_GATE_STEP_RESULT);
  const failed=await activeCommand(process.execPath,["-e","process.exit(7)"],{cwd:root,env});
  assert.equal(failed.status,7);assert.equal(failed.hung,undefined);assert.equal(existsSync(env.NTS_GATE_STEP_RESULT),false);
});

test("CPU runaway budgets hold a busy loop without manufacturing a verdict",async t=>{
  const {root,env}=fixture(t),ready=join(root,"busy");
  const result=await activeCommand(process.execPath,["-e","require('node:fs').writeFileSync(process.argv[1],'ready');while(true){}",ready],{cwd:root,env,idleMs:2000,pollMs:50,cpuBudgetSeconds:0.25});
  assert.ok(existsSync(ready));assert.equal(result.hung,undefined);
  assert.match(result.runaway!,/user\+sys CPU .* reached its 0.25 s budget/);
  const frame=readStepInstrument(env.NTS_GATE_STEP_RESULT,"c-compiles","active-control");
  assert.equal(frame?.verdict,"NOT RUN");assert.equal(frame?.kind,"runaway");
});

test("a grandchild outliving its parent is stopped with the owned group",async t=>{
  const {root,env}=fixture(t),ready=join(root,"grandchild");
  const grandchild=`require('node:fs').writeFileSync(process.argv[1],String(process.pid));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);`;
  const parent=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)},process.argv[1]],{stdio:['ignore','inherit','inherit']}).once('spawn',()=>process.exit(0));`;
  const result=await activeCommand(process.execPath,["-e",parent,ready],{cwd:root,env,idleMs:2000,pollMs:50});
  assert.ok(result.hung);assert.equal(readStepInstrument(env.NTS_GATE_STEP_RESULT,"c-compiles","active-control")?.verdict,"NOT RUN");
  assert.ok(existsSync(ready));const pid=Number(readFileSync(ready,"utf8"));
  await waitFor("the directly recorded grandchild to leave its group",()=>{
    try{return /^\d+ \(.+\) Z /.test(readFileSync(`/proc/${pid}/stat`,"utf8"));}catch(error){if(error.code==="ENOENT")return true;throw error;}
  });
});

test("close reaps a helper whose redirected stdio does not keep the leader open",async t=>{
  const {root,env}=fixture(t),ready=join(root,"redirected-helper");
  const helper=join(root,"helper.cjs");
  writeFileSync(helper,"require('node:fs').writeFileSync(process.argv[2],String(process.pid));process.send('ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);\n");
  const parent="require('node:child_process').fork(process.argv[1],[process.argv[2]],{stdio:['ignore','ignore','ignore','ipc']}).once('message',()=>process.exit(0));";
  const result=await activeCommand(process.execPath,["-e",parent,helper,ready],{cwd:root,env});
  assert.equal(result.status,0);assert.equal(result.hung,undefined);assert.equal(result.runaway,undefined);
  assert.equal(existsSync(env.NTS_GATE_STEP_RESULT),false);
  const pid=Number(readFileSync(ready,"utf8"));
  await waitFor("the helper with redirected stdio to leave its directly owned group",()=>{
    try{return /^\d+ \(.+\) Z /.test(readFileSync(`/proc/${pid}/stat`,"utf8"));}catch(error){if(error.code==="ENOENT")return true;throw error;}
  });
});
