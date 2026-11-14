import {commandObservationFixture} from './command-observations-fixture.ts';
import {testEnvironment,testEnvironmentHandoff,fixtureEnvironment} from "./test-environment.ts";
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {existsSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {join} from "node:path";
import {test} from "node:test";
import {activeCommand,processActivity,CommandActivitySampler,threadsBusy,liveCommandObservations} from "./active-command.ts";
import {readStepInstrument} from "./step-result.ts";
import {waitFor} from "./test-wait.ts";
import {testScratch} from "./test-scratch.ts";
import {toolingSliceArgs} from "./tooling-slice.ts";

function fixture(t) {
  const root=testScratch(t,"active-command-case");
  return {root,env:{...fixtureEnvironment(t),NTS_GATE_STEP:"c-compiles",NTS_GATE_STEP_ATTEMPT:"active-control",NTS_GATE_STEP_RESULT:join(root,"result.json")}};
}

function processHasExited(pid:number,readStat=()=>readFileSync(`/proc/${pid}/stat`,"utf8")):boolean {
  try{return /^\d+ \(.+\) Z /.test(readStat());}
  catch(error){if(error.code==="ENOENT"||error.code==="ESRCH")return true;throw error;}
}

test("the exit probe reads a reaped child and preserves other read errors",t=>{
  const {root,env}=fixture(t);
  assert.equal(processHasExited(process.pid),false);
  const child=spawnSync(process.execPath,["-e",""],{cwd:root,env});
  assert.equal(child.status,0);assert.equal(child.signal,null);assert.ok(child.pid>0);
  assert.equal(processHasExited(child.pid),true);
  for(const code of ["ENOENT","ESRCH"]){
    const error=Object.assign(new Error(code),{code});
    assert.equal(processHasExited(child.pid,()=>{throw error;}),true);
  }
  for(const error of [Object.assign(new Error("denied"),{code:"EACCES"}),new Error("other read error")]){
    assert.throws(()=>processHasExited(child.pid,()=>{throw error;}),caught=>caught===error);
  }
});

test("process activity parses group identity and all user/sys CPU including reaped children",()=>{
  const fields=Array(20).fill("0");fields[0]="S";
  for(const [at,value] of [[2,41],[3,41],[11,5],[12,7],[13,11],[14,13],[19,123]])fields[at]=String(value);
  assert.deepEqual(processActivity(`41 (a name with ) in it) ${fields.join(" ")}`),{parent:0,group:41,session:41,cpu:36,own:12,started:123,busy:false});
  fields[0]="R";
  assert.equal(processActivity(`41 (waiting for a CPU) ${fields.join(" ")}`).busy,true,"state R is running or waiting for a CPU");
  fields[0]="D";
  assert.equal(processActivity(`41 (waiting on disk) ${fields.join(" ")}`).busy,true,"state D waits on the kernel's I/O");
  assert.throws(()=>processActivity("unreadable"),/invalid/);
});

test("one activity snapshot serves concurrent groups without sharing their progress",()=>{
  let scans=0;
  const records=new Map([
    [41,{group:41,session:41,cpu:10,started:100}],
    [42,{group:42,session:41,cpu:7,started:101}],
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

test("a group with a busy thread is reported as busy, without CPU progress",()=>{
  // A loaded machine can keep a thread waiting for a CPU or for its pages past
  // the idle guard: it makes no CPU progress then, but its state says it is
  // not idle.
  const records=new Map([
    [61,{group:61,session:61,cpu:5,started:300,busy:false}],
    [62,{group:62,session:61,cpu:0,started:301,busy:true}],
    [71,{group:71,session:71,cpu:5,started:400,busy:false}],
  ]);
  const sampler=new CommandActivitySampler(()=>records);
  const seen:[number,boolean][][]=[[],[]];
  const cancel=[61,71].map((group,index)=>sampler.watch({group,started:group===61?300:400,pollMs:5000,sample:(cpu,_own,busy)=>seen[index].push([cpu,busy]),broken:error=>{throw error;}}));
  try{
    sampler.sample();records.get(62)!.busy=false;sampler.sample();
    assert.deepEqual(seen,[[[5,true],[5,false]],[[5,false],[5,false]]]);
  }finally{cancel.forEach(stop=>stop());}
});

test("every thread's state counts: this test's own thread is busy, a sleeping child's are not",async()=>{
  assert.equal(threadsBusy(process.pid),true,"the thread reading its own state is running");
  const child=spawn(process.execPath,["-e","require('node:fs').writeSync(1,'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)"],{env:testEnvironment(),stdio:['ignore','pipe','ignore']});
  let closed=false,ready=false;child.stdout.on('data',()=>{ready=true;});
  const done=new Promise<void>(resolve=>child.on('close',()=>{closed=true;resolve();}));
  try{
    await waitFor("every thread of the ready sleeping child asleep",()=>ready&&!threadsBusy(child.pid!),{stopped:()=>closed?"the sleeping child exited":undefined});
  }finally{child.kill("SIGKILL");await done;}
  assert.equal(threadsBusy(2**22+1),false,"no such process has no busy thread");
});

test("structured stdout stays separate while command diagnostics are retained",async t=>{
  const {root,env}=fixture(t);
  const result=await activeCommand(process.execPath,["-e","process.stderr.write('diagnostic\\n');process.stdout.write(JSON.stringify({value:7}));"],{cwd:root,env});
  assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{value:7});assert.equal(result.stderr,"diagnostic\n");assert.ok(result.out.includes("diagnostic\n"));assert.ok(result.out.includes(result.stdout));
});

test("live session observations include CPU in a nested owned group",async t=>{
  const {root,env}=fixture(t),ready=join(root,'ready'),release=join(root,'release'),live=liveCommandObservations(env);
  let descendant=false;
  const observations={...live,watch:watch=>live.watch({...watch,sample:(cpu,own,busy,processOwn)=>{
    watch.sample(cpu,own,busy,processOwn);
    if(cpu>own&&existsSync(ready)){descendant=true;writeFileSync(release,'release');}
  }})};
  const body="import os\nopen("+JSON.stringify(ready)+",'w').close()\nwhile not os.path.exists("+JSON.stringify(release)+"): pass";
  const parent=`import subprocess\np=subprocess.Popen(['python3','-c',${JSON.stringify(body)}],process_group=0)\np.wait()\nraise SystemExit(p.returncode)`;
  const result=await activeCommand('python3',['-c',parent],{cwd:root,env,pollMs:50,observations});
  assert.equal(descendant,true,'the shared session snapshot observes child CPU beyond the waiting leader');
  assert.equal(result.status,0,result.out);assert.equal(result.hung,undefined);assert.equal(result.runaway,undefined);
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

test("live busy activity reaches the command owner after readiness",async t=>{
  const {root,env}=fixture(t),ready=join(root,'ready'),release=join(root,'release'),live=liveCommandObservations(env);
  let sampled=false;
  const observations={...live,watch:watch=>live.watch({...watch,sample:(cpu,own,busy,processOwn)=>{
    watch.sample(cpu,own,busy,processOwn);
    if(cpu>0&&busy&&existsSync(ready)){sampled=true;writeFileSync(release,'release');}
  }})};
  const body=`const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');while(!fs.existsSync(process.argv[2])){};process.stdout.write('complete\\n');`;
  const result=await activeCommand(process.execPath,['-e',body,ready,release],{cwd:root,env,pollMs:50,observations});
  assert.equal(sampled,true);assert.equal(result.status,0,result.out);assert.equal(result.out,'complete\n');assert.equal(result.hung,undefined);
  assert.equal(existsSync(env.NTS_GATE_STEP_RESULT),false);
});

test("a live memory.high and busy-state observation releases its kernel control",async t=>{
  // The pure busy-state sequence covers any stall length. This live control
  // releases on the kernel's memory.high/D-state readiness, never after time.
  const {root,env}=fixture(t),unit=`nts-test-memory-held-${randomUUID().slice(0,8)}`,live=liveCommandObservations(env);
  t.after(()=>{spawnSync('systemctl',['--user','stop',`${unit}.scope`],{env:fixtureEnvironment(t),stdio:'ignore'});});
  const control=(...args:string[])=>{const r=spawnSync('systemctl',['--user',...args],{env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  let lifted=false,high=0;
  const observations={...live,watch:watch=>live.watch({...watch,sample:(cpu,own,busy,processOwn)=>{
    watch.sample(cpu,own,busy,processOwn);if(lifted)return;
    try{
      const group=control('show',`${unit}.scope`,'--property=ControlGroup','--value');if(!group)return;
      const pid=readFileSync(`/sys/fs/cgroup${group}/cgroup.procs`,'utf8').trim().split('\n')[0];if(!pid)return;
      const stat=readFileSync(`/proc/${pid}/stat`,'utf8'),state=stat.slice(stat.lastIndexOf(')')+2).split(' ')[0];
      high=Number(/^high (\d+)$/m.exec(readFileSync(`/sys/fs/cgroup${group}/memory.events`,'utf8'))?.[1]);
      if(high>0&&state==='D'&&busy){control('set-property','--runtime',`${unit}.scope`,'MemoryHigh=infinity');lifted=true;}
    }catch(error){if(!String(error).includes('No such file'))throw error;}
  }})};
  const result=await activeCommand('systemd-run',['--user','--scope','--quiet','--collect',`--unit=${unit}`,...toolingSliceArgs(),
    '-p','MemoryHigh=64M','-p','MemoryMax=1G','-p','MemorySwapMax=0','--',
    process.execPath,'-e',"const held=[];for(let i=0;i<16;i++)held.push(Buffer.alloc(16*2**20,1));process.stdout.write('complete\\n');"],{cwd:root,env,pollMs:50,observations});
  assert.equal(lifted,true,`no memory.high/D-state readiness observed (${high} high events)`);
  assert.equal(result.hung,undefined,result.out);assert.equal(result.status,0,result.out);assert.equal(result.stdout,'complete\n');
  assert.equal(existsSync(env.NTS_GATE_STEP_RESULT),false);
});

test("a completed real exit keeps its status without a liveness frame",async t=>{
  const {root,env}=fixture(t);
  // Supplied hung/runaway decisions and their frames are proved by the bridge
  // controls. This live exit carries only the child's completed status.
  const failed=await activeCommand(process.execPath,['-e','process.exit(7)'],{cwd:root,env});
  assert.equal(failed.status,7);assert.equal(failed.hung,undefined);assert.equal(existsSync(env.NTS_GATE_STEP_RESULT),false);
});


test("leader exit stops its grandchild even when inherited pipes postpone close",async t=>{
  const {root,env}=fixture(t),ready=join(root,"grandchild");
  const helper=join(root,"helper.cjs");
  writeFileSync(helper,"require('node:fs').writeFileSync(process.argv[2],String(process.pid));process.send('ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);\n");
  const parent="require('node:child_process').fork(process.argv[1],[process.argv[2]],{stdio:['ignore','inherit','inherit','ipc']}).once('message',()=>process.exit(0));";
  const result=await activeCommand(process.execPath,["-e",parent,helper,ready],{cwd:root,env});
  assert.equal(result.status,0);assert.equal(result.hung,undefined);assert.equal(result.runaway,undefined);
  assert.equal(existsSync(env.NTS_GATE_STEP_RESULT),false);
  assert.ok(existsSync(ready));const pid=Number(readFileSync(ready,"utf8"));
  await waitFor("the directly recorded grandchild to leave its group",()=>processHasExited(pid));
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
  await waitFor("the helper with redirected stdio to leave its directly owned group",()=>processHasExited(pid));
});

test("nested supervisors forward observed busy/output progress while idle children hold",async t=>{
  const {root,env}=fixture(t),helper=join(root,'nested.ts');
  writeFileSync(helper,`import {activeCommand} from ${JSON.stringify(new URL('./active-command.ts',import.meta.url).href)};
import {commandObservationFixture} from ${JSON.stringify(new URL('./command-observations-fixture.ts',import.meta.url).href)};
import {writeFileSync} from 'node:fs';
const mode=process.argv[2],release=process.argv[3],control=commandObservationFixture();
const env={...${testEnvironmentHandoff(['NTS_GATE_STEP','NTS_GATE_STEP_ATTEMPT','NTS_GATE_STEP_RESULT','NTS_GATE_STEP_MEMORY_BYTES'])}};delete env.NTS_GATE_STEP_RESULT;
const body="import {watch,existsSync} from 'node:fs';await new Promise(resolve=>{const observer=watch(process.cwd(),()=>{if(existsSync(process.argv[1])){observer.close();resolve();}});process.stdout.write('ready');});process.stdout.write('complete');";
let ready=false;
const result=await activeCommand(process.execPath,['--input-type=module','-e',body,release],{cwd:process.cwd(),env,idleMs:500,observations:control.observations,
 onActivity:event=>{process.stdout.write(JSON.stringify({cpu:event.cpu})+'\\n');
  if(!ready){ready=true;if(mode==='idle')control.sample(500);else{if(mode==='busy')control.sample(9_000_000,{busy:true});else control.clock(9_000_000);writeFileSync(release,'release');}}
  else if(mode==='output')control.sample(9_000_000);
 }});
process.stdout.write(JSON.stringify({result})+'\\n');process.exitCode=result.hung?124:result.status??1;
`);
  for(const mode of ['busy','output','idle']){
    const result=await activeCommand(process.execPath,[helper,mode,join(root,'release-'+mode)],{cwd:root,env});
    const frames=result.stdout.trim().split('\n').map(line=>JSON.parse(line)),inner=frames.pop().result;
    assert.equal(result.hung,undefined);
    if(mode==='idle'){assert.equal(result.status,124);assert.ok(inner.hung);}
    else{assert.equal(result.status,0,result.out);assert.equal(inner.hung,undefined);assert.ok(frames.length>0);
      if(mode==='output')assert.equal(new Set(frames.map(frame=>frame.cpu)).size,1,'output progress requires no CPU-counter change');}
  }
});

test("an escaped helper retaining pipes still holds instead of disabling supervision",async t=>{
  const {root,env}=fixture(t),helper=join(root,'escaped.cjs'),ready=join(root,'escaped-ready'),control=commandObservationFixture();
  writeFileSync(helper,"require('node:fs').writeFileSync(process.argv[2],'ready');process.send('ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);\n");
  const parent="require('node:child_process').fork(process.argv[1],[process.argv[2]],{detached:true,stdio:['ignore','inherit','inherit','ipc']}).once('message',()=>process.exit(0));";
  const running=activeCommand(process.execPath,['-e',parent,helper,ready],{cwd:root,env,idleMs:500,observations:control.observations});
  await control.attached;
  await waitFor('escaped helper readiness and the recorded leader exit',()=>existsSync(ready)&&processHasExited(control.group()!));
  control.sample(500);const result=await running;
  assert.ok(result.hung);assert.equal(readStepInstrument(env.NTS_GATE_STEP_RESULT,'c-compiles','active-control')?.verdict,'NOT RUN');
  // The suite's named unit removes the helper that deliberately escaped its group.
});
