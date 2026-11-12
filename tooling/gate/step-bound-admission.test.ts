import {fixtureEnvironment} from "./test-environment.ts";
// A real tokened step waits past its execution allowance without spending
// it. The control holds a token forever and still reaches its own bound.
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {copyFileSync,existsSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {test,type TestContext} from "node:test";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {gateEnvironment,hostEnvironment} from "./canonical-environment.ts";
import {readLedger,reserve,type Reservation} from "./memory-ledger.ts";
import {copyModuleClosure} from "./module-closure-fixture.ts";
import {removable} from "./run-temporary.ts";
import type {BoundWait} from "./step-bound.ts";
import {ownMemory} from "./test-memory.ts";
import {caseMemoryKey,caseHistoryFile,writeCaseHistory} from './step-scheduling.ts';
import {newTestScratch} from "./test-scratch.ts";
import {waitFor} from "./test-wait.ts";
import {newToolingSlice,stopToolingSlice,toolingSlice} from "./tooling-slice.ts";

const SOURCE=fileURLToPath(new URL("../../",import.meta.url));
const STEP="test262-census-c", GiB=2**30;
type Observation={now:number;waiting:BoundWait|null;used_s:number;waited_s:Partial<Record<BoundWait,number>>;expired:boolean};

function fixture(t:TestContext,mode:"memory"|"priority"|"active"|"ceiling") {
  const own=newTestScratch("bound-admission"),root=join(own,"repo"),gate=join(root,"tooling/gate");
  const inherited=toolingSlice(),slice=inherited??newToolingSlice(true),unit=`nts-test-bound-admission-${randomUUID()}`;
  let cancel:AbortController|undefined,holder:Reservation|undefined;
  t.after(()=>{
    cancel?.abort();holder?.release();spawnSync("systemctl",["--user","stop",unit],{env:fixtureEnvironment(t),stdio:"ignore"});
    if(!inherited)stopToolingSlice(slice);
    removable(own);rmSync(own,{recursive:true,force:true});
  });
  copyModuleClosure(["tooling/gate/run.mjs","tooling/gate/tokens.mjs"],root);
  const table=join(gate,"step-table.mjs");
  writeFileSync(table,readFileSync(table,"utf8").replace(`name: "${STEP}", bound: 3600`,`name: "${STEP}", bound: 3`));
  assert.match(readFileSync(table,"utf8"),/name: "test262-census-c", bound: 3,/);
  const listed=spawnSync("sh",[join(SOURCE,"tooling/gate/all.sh"),"--list"],{env:fixtureEnvironment(t),encoding:"utf8"});
  assert.equal(listed.status,0,listed.stderr);
  writeFileSync(join(gate,"all.sh"),`#!/bin/sh
if [ "$1" = --list ];then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(gate,"payload.mjs"))}
fi
`);
  const clock=join(own,"clock"),observed=join(own,"observed"),startup=join(own,"startup"),start=join(own,"start");
  const ready=join(own,"ready"),go=join(own,"go"),entered=join(own,"entered");
  writeFileSync(clock,"0");
  // Only this runner reads the controlled clock. Record its actual bound
  // observations before allowing the test to advance beyond an admission wait.
  writeFileSync(join(gate,"entry.mjs"),`
import fs,{readFileSync} from "node:fs";
import {durableRecord} from ${JSON.stringify(new URL("./durable-record.ts",import.meta.url).href)};
import {syncBuiltinESMExports} from "node:module";
// Fail at the hidden read itself, even when this real host has ample room.
const read=fs.readFileSync;
fs.readFileSync=(path,...args)=>{if(/^\\/proc\\/(meminfo|vmstat)$/.test(String(path)))throw Error("fixture reached host "+path);return read(path,...args);};
fs.statfsSync=()=>{throw Error("fixture reached host disk");};
syncBuiltinESMExports();
import {StepBoundClock} from "./step-bound.ts";
const observe=StepBoundClock.prototype.observe;
StepBoundClock.prototype.observe=function(now,waiting){
  const result=observe.call(this,now,waiting);
  durableRecord(${JSON.stringify(observed)},{now,waiting:waiting??null,...result});
  return result;
};
await import("./run.mjs");
`);
  writeFileSync(join(gate,"payload.mjs"),`
import {existsSync,watch,writeFileSync} from "node:fs";
import {acquireToken} from "./tokens.mjs";
async function waitForFile(file){
  if(existsSync(file))return;
  await new Promise(resolve=>{const check=()=>{if(existsSync(file)){w.close();resolve();}};const w=watch(${JSON.stringify(own)},check);check();});
}
writeFileSync(${JSON.stringify(startup)},"startup");
await waitForFile(${JSON.stringify(start)});
writeFileSync(${JSON.stringify(ready)},"ready");
await waitForFile(${JSON.stringify(go)});
const release=await acquireToken({project:"bound-control"});
writeFileSync(${JSON.stringify(entered)},"entered");
console.log("case entered");
${mode==="active"?'await new Promise(()=>{});':'release();console.log("case complete");'}
`);
  // Top-level await without another handle exits; the active control must
  // remain alive while holding its token, so keep a filesystem watcher.
  if(mode==="active")writeFileSync(join(gate,"payload.mjs"),readFileSync(join(gate,"payload.mjs"),"utf8").replace('await new Promise(()=>{});',`await new Promise(()=>{watch(${JSON.stringify(own)},()=>{});});`));
  oracleWorkspaceFixture(t,root);
  const memoryDir=join(own,"memory"),memory=ownMemory(memoryDir,{availableKiB:mode==="active"?16*2**20:3.25*2**20,totalKiB:16*2**20,clock:{kind:"file",file:clock}});
  mkdirSync(memory.NTS_GATE_COSTS_DIR,{recursive:true});
  writeFileSync(join(memory.NTS_GATE_COSTS_DIR,"steps.json"),JSON.stringify({version:3,steps:{[STEP]:{memory:{unit:"token",peaks:[Math.floor(2*GiB/1.25)]}}},
    jobs:{"oracle-dependency-capture":{unit:"worker",peaks:[1]}}}));
  assert.equal(writeCaseHistory(caseHistoryFile(STEP,memory,root),[{key:caseMemoryKey({step:STEP,backend:'',path:'bound-control'}),peak:Math.floor(2*GiB/1.25)}]),undefined);
  mkdirSync(join(own,"target/release"),{recursive:true});
  writeFileSync(join(own,"target/release/nts"),"#!/bin/sh\nexit 0\n",{mode:0o755});
  const run=join(own,"run"),planned=gateEnvironment({...hostEnvironment(process.env),HOME:join(own,"home")},{run,owned:{
    ...memory,NTS_GATE_STEPS:STEP,NTS_GATE_SLOTS:"8",NTS_TOOLING_SLICE:slice,CARGO_TARGET_DIR:join(own,"target"),
    ...(mode==="ceiling"?{NTS_GATE_STEP_CEILING_S:"1"}:{}),
  }});
  const child=spawn("systemd-run",["--user",`--unit=${unit}`,`--slice=${slice}`,"--collect","--quiet","--wait","--pipe",
    "-p","LimitCORE=0","-p","Nice=19","-p","CPUAffinity=0-3 6-31","-p","RuntimeMaxSec=180s","-p","TimeoutStopSec=5s",
    `--working-directory=${root}`,...Object.entries(planned.env).filter((pair):pair is [string,string]=>pair[1]!==undefined).map(([key,value])=>`--setenv=${key}=${value}`),
    process.execPath,join(gate,"entry.mjs")],{env:fixtureEnvironment(t),stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",b=>{output+=b;});child.stderr.on("data",b=>{output+=b;});
  const done=once(child,"close"),stopped=()=>child.exitCode!==null||child.signalCode!==null?`runner exited ${child.exitCode??child.signalCode}: ${output}`:undefined;
  const observation=():Observation|undefined=>existsSync(observed)?JSON.parse(readFileSync(observed,"utf8")):undefined;
  return {own,run,go,entered,memory,memoryDir,done,stopped,observation,output:()=>output,
    start:async()=>{
      await waitFor("the paused payload's startup",()=>existsSync(startup),{stopped});
      await waitFor("the runner's initial bound observation",()=>observation()?.now===0,{stopped});
      assert.equal(observation()?.used_s,0);
      writeFileSync(start,"start");
      await waitFor("the step's feed to start",()=>existsSync(ready),{stopped});
    },
    advance:async(now:number)=>{
      writeFileSync(clock+".next",String(now));renameSync(clock+".next",clock);
      await waitFor("the runner to observe its advanced clock",()=>observation()?.now===now,{stopped});
      return observation()!;
    },
    preempt:async()=>{
      cancel=new AbortController();
      // This fits when the run gives its unused forecast back, but not
      // beside its live use and margin. An impossible request cannot outrank.
      const pending=reserve({bytes:1.25*GiB,priority:"landing",what:"priority control"},{env:memory,signal:cancel.signal,used:()=>0,report:()=>{}})
        .then(value=>{holder=value;},error=>{if(!cancel!.signal.aborted)throw error;});
      await waitFor("the higher priority request to wait",()=>readLedger(memory.NTS_MEMORY_LEDGER).waiting.some(r=>r.what==="priority control"),{stopped});
      return async()=>{cancel!.abort();await pending;holder?.release();};
    }};
}

for(const mode of ["memory","priority"] as const)test(`a census resumes after a ${mode} admission wait past its execution allowance`,async t=>{
  const f=fixture(t,mode);
  await f.start();
  const release=mode==="priority"?await f.preempt():async()=>{};
  writeFileSync(f.go,"go");
  await waitFor("the runner to observe its admission wait",()=>f.observation()?.waiting===mode,{stopped:f.stopped});
  const elapsed=await f.advance(4500);
  assert.equal(elapsed.used_s,0);
  assert.equal(elapsed.waited_s[mode],4.5);
  assert.equal(elapsed.expired,false);
  await release();ownMemory(f.memoryDir,{availableKiB:16*2**20,totalKiB:16*2**20});
  assert.deepEqual(await f.done,[0,null],f.output());
  const summary=JSON.parse(readFileSync(join(f.run,"summary.json"),"utf8"));
  assert.equal(summary.steps[0].verdict,"PASS",f.output());
  assert.equal(summary.steps[0].bound_clock.execution_s,0);
  assert.equal(summary.steps[0].bound_clock.admission_wait_s[mode],4.5);
  assert.match(readFileSync(summary.steps[0].log,"utf8"),/case complete/);
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
});

for(const mode of ["active","ceiling"] as const)test(`${mode==="active"?"a census holding a case":"a waiting census under a landing wall ceiling"} still reaches its bound`,async t=>{
  const f=fixture(t,mode);await f.start();writeFileSync(f.go,"go");
  await waitFor("the case or its memory wait",()=>mode==="active"?existsSync(f.entered):f.observation()?.waiting==="memory",{stopped:f.stopped});
  const elapsed=await f.advance(mode==="active"?4000:2000);
  assert.equal(elapsed.expired,true);
  assert.equal(elapsed.used_s,mode==="active"?4:0);
  assert.deepEqual(await f.done,[1,null],f.output());
  const row=JSON.parse(readFileSync(join(f.run,"summary.json"),"utf8")).steps[0];
  assert.equal(row.verdict,"INSTRUMENT",f.output());assert.equal(row.instrument.kind,"step-bound");
  assert.match(row.reason,mode==="active"?/step exceeded its bound of 3 s/:/landing wall ceiling of 1 s/);
});
