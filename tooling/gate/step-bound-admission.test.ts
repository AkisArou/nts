// A real tokened step waits past its execution allowance without spending
// it. The control holds a token forever and still reaches its own bound.
import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {test,type TestContext} from "node:test";
import {setTimeout} from "node:timers/promises";
import {oracleWorkspaceFixture} from "../differential/oracle-workspace-fixture.ts";
import {gateEnvironment,hostEnvironment} from "./canonical-environment.ts";
import {readLedger,reserve,type Reservation} from "./memory-ledger.ts";
import {moduleClosure} from "./module-closure-fixture.ts";
import {removable} from "./run-temporary.ts";
import {ownMemory} from "./test-memory.ts";
import {newTestScratch} from "./test-scratch.ts";
import {waitFor} from "./test-wait.ts";
import {newToolingSlice,stopToolingSlice,toolingSlice} from "./tooling-slice.ts";

const SOURCE=fileURLToPath(new URL("../../",import.meta.url));
const STEP="test262-census-c", GiB=2**30;

function fixture(t:TestContext,mode:"memory"|"priority"|"active"|"ceiling") {
  const own=newTestScratch("bound-admission"),root=join(own,"repo"),gate=join(root,"tooling/gate");
  const inherited=toolingSlice(),slice=inherited??newToolingSlice(true),unit=`nts-test-bound-admission-${randomUUID()}`;
  let cancel:AbortController|undefined,holder:Reservation|undefined;
  t.after(()=>{
    cancel?.abort();holder?.release();spawnSync("systemctl",["--user","stop",unit],{stdio:"ignore"});
    if(!inherited)stopToolingSlice(slice);
    removable(own);rmSync(own,{recursive:true,force:true});
  });
  for(const file of moduleClosure(["tooling/gate/run.mjs"])) {
    const target=join(root,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(SOURCE,file),target);
  }
  copyFileSync(join(SOURCE,"tooling/gate/tokens.mjs"),join(gate,"tokens.mjs"));
  const table=join(gate,"step-table.mjs");
  writeFileSync(table,readFileSync(table,"utf8").replace(`name: "${STEP}", bound: 3600`,`name: "${STEP}", bound: 3`));
  assert.match(readFileSync(table,"utf8"),/name: "test262-census-c", bound: 3,/);
  const listed=spawnSync("sh",[join(SOURCE,"tooling/gate/all.sh"),"--list"],{encoding:"utf8"});
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
  const ready=join(own,"ready"),go=join(own,"go");
  writeFileSync(join(gate,"payload.mjs"),`
import {existsSync,watch,writeFileSync} from "node:fs";
import {acquireToken} from "./tokens.mjs";
writeFileSync(${JSON.stringify(ready)},"ready");
if(!existsSync(${JSON.stringify(go)}))await new Promise(resolve=>{const check=()=>{if(existsSync(${JSON.stringify(go)})){w.close();resolve();}};const w=watch(${JSON.stringify(own)},check);check();});
const release=await acquireToken({project:"bound-control"});
console.log("case entered");
${mode==="active"?'await new Promise(()=>{});':'release();console.log("case complete");'}
`);
  // Top-level await without another handle exits; the active control must
  // remain alive while holding its token, so keep a filesystem watcher.
  if(mode==="active")writeFileSync(join(gate,"payload.mjs"),readFileSync(join(gate,"payload.mjs"),"utf8").replace('await new Promise(()=>{});',`await new Promise(()=>{watch(${JSON.stringify(own)},()=>{});});`));
  oracleWorkspaceFixture(t,root);
  const memoryDir=join(own,"memory"),memory=ownMemory(memoryDir,{availableKiB:mode==="active"?16*2**20:3.25*2**20,totalKiB:16*2**20});
  mkdirSync(memory.NTS_GATE_COSTS_DIR,{recursive:true});
  writeFileSync(join(memory.NTS_GATE_COSTS_DIR,"steps.json"),JSON.stringify({version:3,steps:{[STEP]:{memory:{unit:"token",peaks:[Math.floor(2*GiB/1.25)]}}},
    jobs:{"oracle-dependency-capture":{unit:"worker",peaks:[1]}}}));
  mkdirSync(join(own,"target/release"),{recursive:true});
  writeFileSync(join(own,"target/release/nts"),"#!/bin/sh\nexit 0\n",{mode:0o755});
  const run=join(own,"run"),planned=gateEnvironment({...hostEnvironment(process.env),HOME:join(own,"home")},{run,owned:{
    ...memory,NTS_GATE_STEPS:STEP,NTS_GATE_SLOTS:"8",NTS_TOOLING_SLICE:slice,CARGO_TARGET_DIR:join(own,"target"),
    ...(mode==="ceiling"?{NTS_GATE_STEP_CEILING_S:"1"}:{}),
  }});
  const child=spawn("systemd-run",["--user",`--unit=${unit}`,`--slice=${slice}`,"--collect","--quiet","--wait","--pipe",
    "-p","LimitCORE=0","-p","Nice=19","-p","CPUAffinity=0-3 6-31","-p","RuntimeMaxSec=180s","-p","TimeoutStopSec=5s",
    `--working-directory=${root}`,...Object.entries(planned.env).filter((pair):pair is [string,string]=>pair[1]!==undefined).map(([key,value])=>`--setenv=${key}=${value}`),
    process.execPath,join(gate,"run.mjs")],{stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",b=>{output+=b;});child.stderr.on("data",b=>{output+=b;});
  const done=once(child,"close"),stopped=()=>child.exitCode!==null?`runner exited ${child.exitCode}: ${output}`:undefined;
  return {own,run,ready,go,memory,memoryDir,done,stopped,output:()=>output,
    preempt:async()=>{
      cancel=new AbortController();
      // This fits when the run gives its unused forecast back, but not
      // beside its live use and margin. An impossible request cannot outrank.
      const pending=reserve({bytes:1.25*GiB,priority:"landing",what:"priority control"},{env:memory,signal:cancel.signal,report:()=>{}})
        .then(value=>{holder=value;},error=>{if(!cancel!.signal.aborted)throw error;});
      await waitFor("the higher priority request to wait",()=>readLedger(memory.NTS_MEMORY_LEDGER).waiting.some(r=>r.what==="priority control"),{stopped});
      return async()=>{cancel!.abort();await pending;holder?.release();};
    }};
}

for(const mode of ["memory","priority"] as const)test(`a census resumes after a ${mode} admission wait past its execution allowance`,async t=>{
  const f=fixture(t,mode);
  await waitFor("the step's feed to start",()=>existsSync(f.ready),{stopped:f.stopped});
  const release=mode==="priority"?await f.preempt():async()=>{};
  writeFileSync(f.go,"go");
  await waitFor("the gate to block admission",()=>mode==="priority"?/higher priority/.test(f.output()):readLedger(f.memory.NTS_MEMORY_LEDGER).waiting.some(r=>r.grows!==null),{stopped:f.stopped});
  // Drive a known admission wait past the three-second allowance. Only the
  // runner's outcome decides the test; elapsed time is not an assertion.
  await setTimeout(4500);
  await release();ownMemory(f.memoryDir,{availableKiB:16*2**20,totalKiB:16*2**20});
  assert.deepEqual(await f.done,[0,null],f.output());
  const summary=JSON.parse(readFileSync(join(f.run,"summary.json"),"utf8"));
  assert.equal(summary.steps[0].verdict,"PASS",f.output());
  assert.equal(Object.hasOwn(summary.steps[0].bound_clock.admission_wait_s,mode),true);
  assert.match(readFileSync(summary.steps[0].log,"utf8"),/case complete/);
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
});

for(const mode of ["active","ceiling"] as const)test(`${mode==="active"?"a census holding a case":"a waiting census under a landing wall ceiling"} still reaches its bound`,async t=>{
  const f=fixture(t,mode);writeFileSync(f.go,"go");
  assert.deepEqual(await f.done,[1,null],f.output());
  const row=JSON.parse(readFileSync(join(f.run,"summary.json"),"utf8")).steps[0];
  assert.equal(row.verdict,"INSTRUMENT",f.output());assert.equal(row.instrument.kind,"step-bound");
  assert.match(row.reason,mode==="active"?/step exceeded its bound of 3 s/:/landing wall ceiling of 1 s/);
});
