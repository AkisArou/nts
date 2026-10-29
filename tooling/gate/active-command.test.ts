import assert from "node:assert/strict";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {activeCommand,processActivity} from "./active-command.ts";
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

test("structured stdout stays separate while command diagnostics are retained",async t=>{
  const {root,env}=fixture(t);
  const result=await activeCommand(process.execPath,["-e","process.stderr.write('diagnostic\\n');process.stdout.write(JSON.stringify({value:7}));"],{cwd:root,env});
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{value:7});assert.equal(result.stderr,"diagnostic\n");assert.ok(result.out.includes("diagnostic\n"));assert.ok(result.out.includes(result.stdout));
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
