import {censusReport, recordedCensus} from "./census-log-fixture.ts";
import {generatedJavaScript} from '../gate/generated-javascript.ts';
// node --test tooling/full-check/measure.test.ts
//
// How a run's summary.json is read: a skip the policy accepts passes, a step
// that did not complete is held, a platform's programs left unrun hold their
// step unless the policy lets that platform stay unrun, and a summary of
// another commit or from a non-canonical environment vouches for nothing.
import assert from "node:assert/strict";
import { chmodSync,existsSync,mkdirSync,mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {spawn} from "node:child_process";
import { censusFailureIdentity, fullCheckBound, pinnedGate, readSummary, RUN_BOUND_FLOOR_S, verdictOf } from "./measure.ts";
import { MEASUREMENT_HOLD, MEASUREMENT_PROGRESS, MEASUREMENT_SETUP_HANG_MS, readMeasurementProgress, type MeasurementProgress } from "./measure-command.ts";
import { fullCheckStatus, liveMeasurement, statusText } from "./service.ts";
import { readState } from "./state.ts";
import { OOM_SCORE, processIdentity, readLedger, reserve, type Priority } from "../gate/memory-ledger.ts";
import { inheritedCpus, gateCpus } from "../gate/affinity.ts";
import { newTestScratch } from "../gate/test-scratch.ts";
import { spawnTest,waitFor } from "../gate/test-wait.ts";
import { newToolingSlice, stopToolingSlice, toolingSliceArgs } from "../gate/tooling-slice.ts";
import {layout} from "./state.ts";
import {scratchRepo} from "../landing/scratch-repo.ts";
import {nodeInstallation} from "../gate/toolchain-fixture.ts";
import {candidateEnvironmentFixture,candidateVersion,resolutionSubject,assertSessionClosed} from './run-environment-fixture.ts';
import {hostEnvironment} from '../gate/host-environment.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {ownMemory} from '../gate/test-memory.ts';
import {fixtureToolingSlice} from '../gate/tooling-slice-fixture.ts';

const COMMIT = "1234567890ab".padEnd(40, "c");

function summary(t: { after(fn: () => void): void }, value: unknown): string {
  const run = mkdtempSync(join(tmpdir(), "full-check-summary-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  writeFileSync(join(run, "summary.json"), typeof value === "string" ? value : JSON.stringify(value));
  return run;
}

const steps = [
  { name: "build", verdict: "PASS" },
  { name: "tests", verdict: "FAIL", reason: "exit 1" },
  { name: "on-device", verdict: "SKIPPED", reason: "SKIP: no device", accepted: true },
  { name: "dex", verdict: "SKIPPED", reason: "SKIP: no d8" },
  { name: "rc", verdict: "INSTRUMENT", reason: "memory pre-check" },
  { name: "llvm", verdict: "NOT RUN", reason: "build failed" },
];

test("the full check's run bounds: stalled three times the last canonical green wall, CPU three times its measured CPU",t=>{
  const baseline="build\t800\t1000\t1\ntests\t1200\t4000\t8\n";
  const run=summary(t,{wall_s:1820.1,verdict:"green",identities:{commit:COMMIT},environment:{canonical:true},executed:["tests","build"]});
  const previous={commit:COMMIT,run,verdict:"green" as const,at:"",failed:[]};
  assert.deepEqual(fullCheckBound(previous,["build","tests"],baseline,24),{stall_s:5461,lifecycle_s:5461,cpu_s:21600},"no measured CPU: the summed baseline, at least fifteen minutes of the machine");
  const progress=(cpu_s:number,more:Partial<MeasurementProgress>={})=>writeFileSync(join(run,MEASUREMENT_PROGRESS),JSON.stringify({version:1,writer:{boot:"b",pid:1,start:"1"},live:false,
    updated_at:"",bounds:{stall_s:1,lifecycle_s:null,cpu_s:null},group:"/g",wall_s:1820,used_s:1800,stalled_s:20,cpu_s,cpu_lost_s:0,outside_s:0,waited_s:{},waiting:null,held:null,...more}));
  progress(30000);
  assert.deepEqual(fullCheckBound(previous,["build","tests"],baseline,24),{stall_s:5461,lifecycle_s:5461,cpu_s:90000},"the green run's measured CPU");
  progress(30000,{held:"held"});
  assert.equal(fullCheckBound(previous,["build","tests"],baseline,24).cpu_s,21600,"a held run measures nothing");
  progress(30000);
  assert.deepEqual(fullCheckBound({...previous,commit:"f".repeat(40)},["build","tests"],baseline,24),{stall_s:3600,lifecycle_s:3600,cpu_s:21600});
  assert.deepEqual(fullCheckBound(undefined,["build"],baseline,24),{stall_s:2400,lifecycle_s:2700,cpu_s:21600},"a cold release build fits the lifecycle bound of a run of short steps");
  assert.deepEqual(fullCheckBound(undefined,["build","tests"],baseline,2),{stall_s:3600,lifecycle_s:3600,cpu_s:15000});
  assert.deepEqual(fullCheckBound(undefined,["format"],baseline,24),{stall_s:900,lifecycle_s:2700,cpu_s:null},"a step with no baseline gives the CPU bound no basis");
  assert.deepEqual(fullCheckBound(previous,["build","tests","new-step"],baseline,24),{stall_s:3600,lifecycle_s:3600,cpu_s:null},"nor does a new step the last green run never ran");
  assert.equal(RUN_BOUND_FLOOR_S,15*60);
});

const GiB=2**30;
// A measurement in its own unit, as the controller starts it: `command` in a
// slice of the full check's rank, with an owned ledger and live CPU.
// A machine of `availableKiB` measures its jobs' resident memory live. With
// `ownedClock`, the measurement's clock is the fixture's: it stands until
// `advance` moves it, so no time before the fixture's own readiness events
// spends a bound, however slowly the machine brings the run up.
// `path` goes ahead of the measurement's PATH, for a stubbed tool.
function measured(t:{after(fn:()=>void|Promise<void>):void},name:string,bounds:{stall:number;lifecycle?:number},command:(run:string)=>string[],options:{slice?:string;availableKiB?:number;rank?:Priority;oomScore?:number;ownedClock?:boolean;path?:string;freeDiskBytes?:number}={}){
  const dir=newTestScratch(name),runs=join(dir,"runs"),run=join(runs,`core-${COMMIT.slice(0,12)}-${randomUUID()}`);
  mkdirSync(run,{recursive:true});
  const clockFile=join(dir,"clock");let clockMs=0;
  const setClock=()=>{writeFileSync(`${clockFile}.next`,String(clockMs));renameSync(`${clockFile}.next`,clockFile);};
  if(options.ownedClock)setClock();
  const memory=ownMemory(join(dir,"machine"),{cpu:{kind:"live"},pressure:{kind:"live"},wallClock:{kind:"live"},...(options.ownedClock?{clock:{kind:"file",file:clockFile}}:{}),
    ...(options.freeDiskBytes===undefined?{}:{disk:{freeBytes:options.freeDiskBytes,freeInodes:100}}),
    ...(options.availableKiB===undefined?{}:{availableKiB:options.availableKiB,resident:{kind:"live"}})});
  mkdirSync(join(memory.NTS_MEMORY_LEDGER,"waiting"),{recursive:true});
  const slice=options.slice??newToolingSlice(true),unit=`nts-test-full-check-${name}-${randomUUID()}`;
  const args=["--user",`--unit=${unit}`,...toolingSliceArgs(process.env,"agent"),"--collect","--quiet","--pipe","--wait",
    "-p","LimitCORE=0","-p","Nice=19","-p","CPUAffinity=0-3 6-31","-p","RuntimeMaxSec=120s",
    ...(options.oomScore===undefined?[]:["-p",`OOMScoreAdjust=${options.oomScore}`]),
    ...Object.entries(memory).map(([key,value])=>`--setenv=${key}=${value}`),
    ...(options.path===undefined?[]:[`--setenv=PATH=${options.path}:${process.env.PATH}`]),
    process.execPath,fileURLToPath(new URL("./measure-command.ts",import.meta.url)),String(bounds.stall),String(bounds.lifecycle??"none"),"none",run,slice,options.rank??"full-check",...command(run)];
  t.after(()=>{
    spawnTest("systemctl",["--user","stop",unit],{encoding:"utf8"});
    stopToolingSlice(slice);
    rmSync(dir,{recursive:true,force:true});
  });
  let output="",ended=false,status:Promise<number|null>|undefined;
  return {run,runs,unit,args,memory,progress:()=>readMeasurementProgress(run),
    /** Moves the owned clock on by `seconds`; the clock's new reading in seconds. */
    advance(seconds:number){if(!options.ownedClock)throw Error("the measurement's clock is live");clockMs+=seconds*1000;setClock();return clockMs/1000;},
    stopped:()=>ended?output:undefined,
    /** Starts it without waiting; `status` then ends with it. */
    start(){
      const child=spawn("systemd-run",args,{stdio:["ignore","pipe","pipe"]});
      child.stdout.on("data",bytes=>output+=bytes);child.stderr.on("data",bytes=>output+=bytes);
      status=new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("close",code=>{ended=true;resolve(code);});});
      t.after(async()=>{spawnTest("systemctl",["--user","stop",unit],{encoding:"utf8"});await status;});
    },
    status:()=>status!,output:()=>output};
}

/** Moves an owned clock on by one receipt's interval, and waits for the receipt that observed it, or for the measurement to end. */
async function tick(m:ReturnType<typeof measured>):Promise<void>{
  const at=m.advance(5);
  await waitFor(`the measurement to observe its clock at ${at} s`,()=>(m.progress()?.wall_s??-1)>=at||m.stopped()!==undefined);
}

const entry=(fields:Record<string,unknown>)=>{
  const me=processIdentity(process.pid)!;
  return {version:2,id:randomUUID(),seq:0,bytes:GiB,what:"job",priority:"agent",owner:me,waiter:me,measure:{tree:true,cgroup:null},since:"2026-11-19T10:00:00.000Z",grows:null,fits:true,...fields};
};
const putWaiting=(ledger:string,value:{id:string})=>writeFileSync(join(ledger,"waiting",`${value.id}.json`),JSON.stringify(value));

test("a run of sleeping processes is held at its stall bound, with the bound and its measured progress, even beside a green summary",t=>{
  const m=measured(t,"stall",{stall:2},()=>["tail","-f","/dev/null"]);
  writeFileSync(join(m.run,"summary.json"),JSON.stringify({
    identities:{commit:COMMIT},environment:{canonical:true},steps:[{name:"program-oracles",verdict:"PASS"}],
  }));
  const result=spawnTest("systemd-run",m.args,{encoding:"utf8"});
  assert.equal(result.status,124,result.stdout+result.stderr);
  const read=readSummary(m.run,COMMIT,["program-oracles"]);
  assert.equal(read.steps["program-oracles"],"HELD");
  assert.match(read.reasons["program-oracles"]!,/^full check run made no progress outside waits for its stall bound of 2 s: in \d+ s it ran [\d.]+ cpu-s, lost \d+ s to higher-ranked CPU work and stalled \d+ s$/);
  const progress=m.progress()!;
  assert.deepEqual([progress.live,progress.held===read.reasons["program-oracles"]],[false,true]);
  assert.ok(progress.stalled_s>=2&&progress.wall_s<20,JSON.stringify(progress));
});

// A run whose one command asks for a 1 GiB temporary through the one disk
// wait owner, on a fixture disk of `freeGiB`; the floor is 40 GiB.
function diskWaiter(t:{after(fn:()=>void|Promise<void>):void},name:string,freeGiB:number){
  return measured(t,name,{stall:2},run=>[process.execPath,"--input-type=module","-e",`import {TemporaryAdmission} from ${JSON.stringify(new URL("../gate/admission.ts",import.meta.url).href)};
const admission=new TemporaryAdmission({path:${JSON.stringify(join(run,"capture"))},context:{kind:"standalone"},reservedBytes:2**30});
const {lease}=await admission.acquire({what:"fixture capture"});lease.release();`],{freeDiskBytes:freeGiB*GiB});
}

test("a run whose temporary waits for disk is held at its stall bound, and its reason names the wait and what holds the disk",t=>{
  const m=diskWaiter(t,"disk-wait",40.5);
  const result=spawnTest("systemd-run",m.args,{encoding:"utf8"});
  assert.equal(result.status,124,result.stdout+result.stderr);
  assert.match(result.stdout+result.stderr,/disk: fixture capture waits for 1\.0 GiB of disk above the 40\.0 GiB floor: 40\.5 GiB free/,"the waiter reports its wait");
  const held=readFileSync(join(m.run,MEASUREMENT_HOLD),"utf8").trim();
  assert.match(held,/^full check run made no progress outside waits for its stall bound of 2 s: in \d+ s it ran [\d.]+ cpu-s, lost \d+ s to higher-ranked CPU work and stalled \d+ s; \d+ s of its stall waiting for disk: fixture capture waits for 1\.0 GiB of disk above the 40\.0 GiB floor: 40\.5 GiB free, 0\.0 GiB promised to builds, 0\.0 GiB to temporaries$/,"a disk wait is named, never excused");
  const progress=m.progress()!;
  assert.equal(progress.held,held);
  assert.ok((progress.disk_stalled_s??0)>0,JSON.stringify(progress));
  assert.equal(progress.disk?.what,"fixture capture");
  assert.equal(progress.waited_s.memory??0,0,"a disk wait spends the stall bound");
});

test("a run whose temporary has its disk is admitted at once, with no disk wait and no hold",t=>{
  const m=diskWaiter(t,"disk-free",60);
  const result=spawnTest("systemd-run",m.args,{encoding:"utf8"});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.doesNotMatch(result.stdout+result.stderr,/disk: /,"free disk reports nothing");
  assert.equal(existsSync(join(m.run,MEASUREMENT_HOLD)),false);
  const progress=m.progress()!;
  assert.deepEqual([progress.disk,progress.disk_stalled_s,progress.held],[null,0,null]);
});

test("a run outranked for CPU by a weighted spinner, but progressing, is never held, however long past its stall and lifecycle bounds it runs",t=>{
  // One CPU of this process's, outside the measurement core, for the spinner and the run alike.
  const cpu=gateCpus(inheritedCpus()).split(",").at(-1)!.split("-").at(-1)!;
  const spinner=`nts-test-full-check-spinner-${randomUUID()}`;
  t.after(()=>{spawnTest("systemctl",["--user","stop",spinner],{encoding:"utf8"});});
  // The spinner at an agent's weight, the run at the full check's: siblings under nts.slice (ranks.ts).
  const spun=spawnTest("systemd-run",["--user",`--unit=${spinner}`,...toolingSliceArgs({},"agent"),"--collect","--quiet",
    "-p","LimitCORE=0","-p","RuntimeMaxSec=120s","taskset","-c",cpu,"sh","-c","while :; do :; done"],{encoding:"utf8"});
  assert.equal(spun.status,0,spun.stderr);
  // Its work runs outside any step, as a release build does: the lifecycle bound holds it no more than the stall bound.
  const m=measured(t,"outranked",{stall:2,lifecycle:2},()=>["taskset","-c",cpu,"sh","-c","i=0; while [ $i -lt 200000 ]; do i=$((i+1)); done"],{slice:newToolingSlice(true,{})});
  const result=spawnTest("systemd-run",m.args,{encoding:"utf8"});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(existsSync(join(m.run,"measurement-hold.txt")),false,"never held");
  const progress=m.progress()!;
  assert.equal(progress.held,null);
  assert.ok(progress.wall_s>2&&progress.cpu_lost_s>2&&progress.stalled_s<2&&progress.outside_s<2,`it ran past its stall and lifecycle bounds, losing the CPU to the spinner: ${JSON.stringify(progress)}`);
});

test("a run whose own request waits behind a never-released higher-ranked one is not held, and the status names that request and since when",async t=>{
  const m=measured(t,"own-wait",{stall:3},()=>["tail","-f","/dev/null"]),ledger=m.memory.NTS_MEMORY_LEDGER;
  // It could never be admitted, so the run yields to it, excused, from its first sample on.
  const landing=entry({what:"a landing that never ends",priority:"landing",bytes:1024*GiB});
  putWaiting(ledger,landing);
  m.start();
  await waitFor("the run's first progress receipt",()=>m.progress()!==null,{stopped:m.stopped});
  const own=entry({what:"gate run of the full check",priority:"full-check",seq:1,measure:{tree:false,cgroup:{path:`${m.progress()!.group}/nts-w.slice`,inode:"1"}}});
  putWaiting(ledger,own);
  await waitFor("the run to wait past its stall bound",()=>(m.progress()?.waited_s.memory??0)>4,{stopped:m.stopped});
  assert.equal(existsSync(join(m.run,"measurement-hold.txt")),false,m.output());
  const live=liveMeasurement(m.runs,COMMIT);
  assert.ok(live,"the live measurement is found by its commit");
  assert.deepEqual([live.progress.waiting?.id,live.progress.waiting?.behind?.id],[own.id,landing.id]);
  const status=fullCheckStatus(readState("/nonexistent"),{main:null,verified:null,unverified:null,landedAt:()=>"",controller:null,count:null,measurement:live,now:new Date(live.progress.updated_at)});
  assert.match(statusText(status),new RegExp(`^measuring: ${m.run} \\(full-check rank\\): ran \\d+ cpu-s in \\d+ s, stalled \\d+ of 3 s, lost \\d+ s to higher-ranked CPU work, waited (priority \\d+ s, )?memory \\d+ s; `
    +`its request gate run of the full check \\(${own.id}\\) waits behind a landing that never ends \\(landing, ${landing.id}\\) since \\S+, \\d+ min$`,"m"));
});

// The holder of the slowed variant stays unready for longer than its stall
// bound: as a loaded machine may bring it up, that time is the fixture's
// setup, and spends nothing of the bound its clock decides.
const slowed=["sh","-c","sleep 3; exec \"$@\"","sh"];
for(const slow of [false,true])test(`a run holding memory at no CPU, which a higher-ranked request waits on, is held at its stall bound${slow?", however slowly it came to hold it,":""} and the request then goes ahead`,async t=>{
  // The machine as the kernel would show it with the holder's 512 MiB in use:
  // 256 MiB beyond the floor, too little for the landing's 512 MiB, which could
  // fit were the holder to end.
  const MiB=2**20,floor=2*GiB/1024;
  const m=measured(t,"circular",{stall:2},run=>[process.execPath,fileURLToPath(new URL("../gate/admit.ts",import.meta.url)),
    "--bytes","600M","--priority","full-check","--what","a hung holder","--",...(slow?slowed:[]),process.execPath,"-e",
    "globalThis.held=Buffer.alloc(512*2**20,1);require('fs').writeFileSync(process.argv[1],'');require('child_process').spawnSync('tail',['-f','/dev/null'])",join(run,"holding")],
    {availableKiB:floor+GiB/1024,ownedClock:true});
  const ledger=m.memory.NTS_MEMORY_LEDGER,machine=join(dirname(m.runs),"machine");
  m.start();
  await waitFor("the holder to hold its memory",()=>existsSync(join(m.run,"holding")),{stopped:m.stopped});
  ownMemory(machine,{availableKiB:floor+256*1024});
  const ending=new AbortController();t.after(()=>ending.abort());
  const landing=reserve({bytes:512*MiB,what:"a landing that needs the holder's memory",priority:"landing"},{env:{...m.memory},everyMs:10,signal:ending.signal});
  landing.catch(()=>{});
  await waitFor("the landing to wait on the holder's memory",()=>readLedger(ledger).waiting.some(row=>row.priority==="landing"&&row.fits===true),{stopped:m.stopped});
  // Only now does the run's clock move: each tick is time it holds the memory, idle.
  for(let ticks=0;!m.progress()?.held;ticks++){assert.ok(ticks<4,`held within four ticks: ${JSON.stringify(m.progress())}`);await tick(m);}
  assert.equal(await m.status(),124,m.output());
  assert.match(readFileSync(join(m.run,MEASUREMENT_HOLD),"utf8"),/^full check run made no progress outside waits for its stall bound of 2 s: /,"being outranked while it holds memory is no wait");
  const progress=m.progress()!;
  assert.ok(progress.stalled_s>=2&&progress.wall_s<=20,`its stall is the time it held the memory, none of its setup: ${JSON.stringify(progress)}`);
  // Stopped, its memory returns to the machine.
  ownMemory(machine,{availableKiB:floor+768*1024});
  const admitted=await landing;
  assert.equal(admitted.bytes,512*MiB,"the request that waited on the holder's memory goes ahead");
  admitted.release();await admitted.closed;
});

for(const small of [false,true])test(`a run that yields to a higher-ranked request waiting on other work's memory${small?", with a small one queued behind it,":""} is not held, however long it yields`,async t=>{
  const MiB=2**20,floor=2*GiB/1024;
  const admit=fileURLToPath(new URL("../gate/admit.ts",import.meta.url));
  const hold=(marker:string)=>[process.execPath,"-e",
    "globalThis.held=Buffer.alloc(512*2**20,1);require('fs').writeFileSync(process.argv[1],'');require('child_process').spawnSync('tail',['-f','/dev/null'])",marker];
  // The run holds an admitted reservation it does not use, and is idle, as a yielding runner is.
  const m=measured(t,"yield",{stall:8},()=>[process.execPath,admit,"--bytes","100M","--priority","full-check","--what","an idle run","--","tail","-f","/dev/null"],
    {availableKiB:floor+2*GiB/1024,ownedClock:true});
  const ledger=m.memory.NTS_MEMORY_LEDGER,machine=join(dirname(m.runs),"machine"),marker=join(m.run,"unrelated-holding");
  // Other work, outside the run, holds 512 MiB at an agent's rank.
  const other=`nts-test-full-check-other-${randomUUID()}`;
  t.after(()=>{spawnTest("systemctl",["--user","stop",other],{encoding:"utf8"});});
  const started=spawnTest("systemd-run",["--user",`--unit=${other}`,...toolingSliceArgs(process.env,"agent"),"--collect","--quiet","-p","LimitCORE=0","-p","RuntimeMaxSec=120s",
    ...Object.entries(m.memory).map(([key,value])=>`--setenv=${key}=${value}`),
    process.execPath,admit,"--bytes","600M","--priority","agent","--what","an unrelated holder","--",...hold(marker)],{encoding:"utf8"});
  assert.equal(started.status,0,started.stderr);
  await waitFor("the unrelated holder to hold its memory",()=>existsSync(marker));
  m.start();
  await waitFor("the run's reservation",()=>readLedger(ledger).admitted.some(row=>row.what==="an idle run"),{stopped:m.stopped});
  // The kernel's view with the other work's 512 MiB in use: 128 MiB beyond the floor.
  ownMemory(machine,{availableKiB:floor+128*1024});
  const ending=new AbortController();t.after(()=>ending.abort());
  const agent=reserve({bytes:512*MiB,what:"an agent's job behind the other work",priority:"agent"},{env:{...m.memory},everyMs:10,signal:ending.signal});
  agent.catch(()=>{});
  // The clock moves only once the request the run yields to waits.
  await waitFor("the agent's job to wait",()=>readLedger(ledger).waiting.some(row=>row.what==="an agent's job behind the other work"),{stopped:m.stopped});
  if(small){
    // It would fit alone, but the queue admits nothing behind its blocked head, the run gone or not.
    reserve({bytes:32*MiB,what:"an agent's small job behind it",priority:"agent"},{env:{...m.memory},everyMs:10,signal:ending.signal}).catch(()=>{});
    await waitFor("the small job to wait",()=>readLedger(ledger).waiting.some(row=>row.what==="an agent's small job behind it"),{stopped:m.stopped});
  }
  // Only now does the run's clock move: at most the first tick precedes a sample that sees the wait.
  for(let ticks=0;(m.progress()?.waited_s.priority??0)<=10;ticks++){
    assert.ok(ticks<6&&m.stopped()===undefined,`yielded past its stall bound within six ticks: ${JSON.stringify(m.progress())}\n${m.output()}`);
    await tick(m);
  }
  assert.equal(existsSync(join(m.run,"measurement-hold.txt")),false,m.output());
  const progress=m.progress()!;
  assert.deepEqual([progress.waiting?.kind,progress.waiting?.what,progress.stalled_s<8],["priority","an agent's job behind the other work",true],JSON.stringify(progress));
  assert.ok(readLedger(ledger).waiting.some(row=>row.priority==="agent"&&row.fits===true),"the agent's job could fit were every admitted job to end");
});

// A probe starts inside the full check's unit, at its OOM score: the
// measurement places the probe's processes at the culprit search's, and the
// full check's own runs stay at theirs (ranks.ts).
for(const rank of ["culprit-search","full-check"] as const)test(`a ${rank} measurement's processes are killed in its rank's turn, and its receipt names the rank`,t=>{
  const m=measured(t,`oom-${rank}`,{stall:30},run=>["sh","-c",'cat /proc/self/oom_score_adj > "$1"',"sh",join(run,"oom")],{rank,oomScore:OOM_SCORE["full-check"]});
  const result=spawnTest("systemd-run",m.args,{encoding:"utf8"});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(Number(readFileSync(join(m.run,"oom"),"utf8")),OOM_SCORE[rank]);
  assert.equal(m.progress()?.rank,rank);
});

test("a scope that never brings the run's command into its slice holds the run at its setup bound, naming the stage, with nothing of the run measured",async t=>{
  // A user manager that accepts the scope's request and never starts it.
  const stubs=newTestScratch("measure-scope-stub");t.after(()=>rmSync(stubs,{recursive:true,force:true}));
  const asked=join(stubs,"asked");
  writeFileSync(join(stubs,"systemd-run"),`#!/bin/sh\n: > '${asked}'\nexec tail -f /dev/null\n`);chmodSync(join(stubs,"systemd-run"),0o755);
  const m=measured(t,"setup-hang",{stall:2,lifecycle:2},run=>["sh","-c",'touch "$1"',"sh",join(run,"ran")],{ownedClock:true,path:stubs});
  m.start();
  await waitFor("the measurement to ask for its scope",()=>existsSync(asked),{stopped:m.stopped});
  m.advance(MEASUREMENT_SETUP_HANG_MS/1000);
  assert.equal(await m.status(),124,m.output());
  assert.match(readFileSync(join(m.run,MEASUREMENT_HOLD),"utf8"),
    new RegExp(`^full check measurement setup, starting the run's scope nts-full-check-measure-[0-9a-f-]+: HostStateError: the run's command did not reach its slice within ${MEASUREMENT_SETUP_HANG_MS/1000} s of asking the user manager for its scope\n$`));
  assert.deepEqual([m.progress(),existsSync(join(m.run,"ran"))],[null,false],"no bound ran, and the command never did");
});

// The scope's readiness wrapper becomes the command: an exit status and a
// signal reach the measurement as the command's own, as without it.
for(const [what,script,status] of [["exits 3","process.exit(3)",3],["is killed by a signal","process.kill(process.pid,'SIGKILL')",1]] as const)test(`a run whose command ${what} ends the measurement with ${status}, unheld`,t=>{
  const m=measured(t,`exit-${status}`,{stall:30},()=>[process.execPath,"-e",script]);
  const result=spawnTest("systemd-run",m.args,{encoding:"utf8"});
  assert.equal(result.status,status,result.stdout+result.stderr);
  assert.equal(existsSync(join(m.run,MEASUREMENT_HOLD)),false,"never held");
  assert.equal(m.progress()?.held,null);
});

test("a run that spins after its last step is held at its lifecycle bound, with no step progress named",t=>{
  const lifecycle=pathToFileURL(fileURLToPath(new URL("../gate/run-lifecycle.ts",import.meta.url))).href;
  const m=measured(t,"lifecycle",{stall:60,lifecycle:2},run=>[process.execPath,"--input-type=module","-e",
    `const {RunLifecycleFeed}=await import(${JSON.stringify(lifecycle)});const feed=new RunLifecycleFeed(${JSON.stringify(run)});feed.started("only");feed.finished("only");for(;;){}`]);
  const result=spawnTest("systemd-run",m.args,{encoding:"utf8"});
  assert.equal(result.status,124,result.stdout+result.stderr);
  assert.match(readFileSync(join(m.run,"measurement-hold.txt"),"utf8"),/^full check run made no step progress for its lifecycle bound of 2 s: no step ran, started or finished for \d+ s of its own time: in \d+ s it ran [\d.]+ cpu-s/);
  const progress=m.progress()!;
  // On a loaded machine the spinner may also lose the CPU or wait on its own startup; what holds it is the lifecycle, far inside its stall bound.
  assert.ok(progress.outside_s>=2&&progress.stalled_s<60&&progress.cpu_s>0,`only its lifecycle held it: ${JSON.stringify(progress)}`);
});

test("the full check launches each measured commit with its pin, including historical commits",t=>{
  const repo=scratchRepo(t,"full-check-toolchain"),paths=layout(repo.dir),installations=join(repo.dir,"installed"),log=join(repo.dir,"node-launches.jsonl");
  const legacySlice=`nts-tooling-${randomUUID().replaceAll("-","")}.slice`;
  for(const pin of ["99.1.0","99.2.0"])nodeInstallation(installations,pin,log);
  const script=`#!/bin/sh
if [ -n "$NTS_GATE_SETUP_ONLY" ];then
  mkdir -p "$NTS_GATE_TREE"
  git archive "$1" | tar -x -C "$NTS_GATE_TREE"
  exit 0
fi
[ "$1" = --environment-ready ] && shift
node --input-type=module -e 'import {writeFileSync} from "node:fs";import {join} from "node:path";if(process.env.NTS_TOOLING_SLICE!==${JSON.stringify(legacySlice)})throw Error("historical slice grammar changed");const run=process.env.NTS_GATE_RUN_DIR;writeFileSync(join(run,"observed-node"),process.env.PATH);writeFileSync(join(run,"observed-rank"),process.env.NTS_MEMORY_PRIORITY);writeFileSync(join(run,"summary.json"),JSON.stringify({identities:{commit:process.argv[1]},environment:{canonical:true},steps:[{name:"tooling",verdict:"PASS"}]}));' "$1"
`;
  candidateEnvironmentFixture(repo.root);
  const naming=join(repo.root,"tooling/gate/tooling-slice.ts");
  writeFileSync(join(repo.root,"tooling/gate/current-tooling-slice.ts"),readFileSync(naming));
  writeFileSync(naming,`export * from './current-tooling-slice.ts';export function newToolingSlice(){return ${JSON.stringify(legacySlice)};}
export function toolingSlice(env=process.env){const value=env.NTS_TOOLING_SLICE;if(value!==undefined&&value!==${JSON.stringify(legacySlice)})throw Error('historical slice grammar changed');return value;}\n`);
  repo.git(['add','-f','tooling']);repo.git(['commit','-qm','private environment']);
  const old=repo.commit({".tool-versions":"nodejs 99.1.0\n","tooling/gate/pinned.sh":script},"first pin");
  const next=repo.commit({".tool-versions":"nodejs 99.2.0\n"},"next pin");
  const {slice}=fixtureToolingSlice(t);
  const gate=pinnedGate(paths,repo.root,()=>{},{nodeInstallations:installations,owned:{...ownMemory(join(repo.dir,'machine')),NTS_TOOLING_SLICE:slice},env:{...hostEnvironment(process.env),HOME:repo.dir}});
  for(const [commit,pin] of [[old,"99.1.0"],[next,"99.2.0"]]){
    const result=gate.run(commit!,["tooling"],pin!);
    assert.equal(result.verdict,"green",JSON.stringify(result.reasons)+"\n"+readFileSync(join(result.run,"full-check.log"),"utf8"));
    assert.equal(readFileSync(join(result.run,"observed-node"),"utf8").split(":")[0],join(installations,pin!,"bin"));
  }
  const missing=repo.commit({".tool-versions":"nodejs 99.3.0\n"},"missing pin");
  const result=gate.run(missing,["tooling"],"missing");
  assert.equal(result.verdict,"held");assert.match(result.reasons.tooling!,/asdf install nodejs 99\.3\.0/);
  const invocations=readFileSync(log,"utf8").trim().split("\n").map(line=>JSON.parse(line) as string[]);
  assert.equal(invocations.filter(args=>args.includes("--input-type=module")).length,4,"both pins construct their slice and execute their private binary");
  const historical = gate.run(old, ["tooling"], "historical-reuse-fallback", undefined, { reuseLanding: true });
  assert.equal(historical.verdict, "green", JSON.stringify(historical.reasons));
  assert.deepEqual(historical.steps, { tooling: "PASS" }, "a historical candidate without a portable contract executes the requested check");
  assert.equal(readFileSync(join(historical.run,"observed-rank"),"utf8"),"full-check","a run the controller names no rank for is the full check's");
  // A probe runs at the rank the controller names where the candidate's own
  // table knows it, and at the full check's where the candidate predates it.
  const lines:string[]=[],ranked=pinnedGate(paths,repo.root,line=>lines.push(line),{nodeInstallations:installations,owned:{...ownMemory(join(repo.dir,'machine')),NTS_TOOLING_SLICE:slice},env:{...hostEnvironment(process.env),HOME:repo.dir}});
  // The fixture's candidates carry this tree's own table.
  const table=readFileSync(fileURLToPath(new URL("../gate/ranks.ts",import.meta.url)),"utf8");
  assert.equal(repo.git(["show",`${next}:tooling/gate/ranks.ts`]),table.trimEnd());
  const probe=ranked.run(next!,["tooling"],"core-probe",undefined,{rank:"culprit-search"});
  assert.equal(probe.verdict,"green",JSON.stringify(probe.reasons));
  assert.equal(readFileSync(join(probe.run,"observed-rank"),"utf8"),"culprit-search");
  const older=table.replace('"landing", "culprit-search", "agent"','"landing", "agent"');
  assert.notEqual(older,table,"the historical table drops the rank");
  const predates=repo.commit({".tool-versions":"nodejs 99.2.0\n","tooling/gate/ranks.ts":older},"a table before the culprit-search rank");
  const fallback=ranked.run(predates,["tooling"],"core-probe",undefined,{rank:"culprit-search"});
  assert.equal(fallback.verdict,"green",JSON.stringify(fallback.reasons));
  assert.equal(readFileSync(join(fallback.run,"observed-rank"),"utf8"),"full-check");
  assert.ok(lines.includes(`${predates.slice(0,12)} predates the culprit-search rank; measuring it at full-check`),lines.join("\n"));
});

test("after a measured run, still under its gate-tree lock, the full check retains its target's incremental state and the verdict stands",t=>{
  const repo=scratchRepo(t,"full-check-retention"),paths=layout(repo.dir),installations=join(repo.dir,"installed");
  nodeInstallation(installations,"99.1.0",join(repo.dir,"node-launches.jsonl"));
  // The run's build leaves two sessions of one unit; rustc reads only the newer.
  const script=`#!/bin/sh
if [ -n "$NTS_GATE_SETUP_ONLY" ];then
  mkdir -p "$NTS_GATE_TREE"
  git archive "$1" | tar -x -C "$NTS_GATE_TREE"
  exit 0
fi
[ "$1" = --environment-ready ] && shift
profile="$CARGO_TARGET_DIR/nts-dev"
mkdir -p "$profile/incremental/unit-0abc/s-a-b-c" "$profile/incremental/unit-0abc/s-d-e-f"
touch "$profile/.cargo-lock" "$profile/incremental/unit-0abc/s-a-b.lock" "$profile/incremental/unit-0abc/s-d-e.lock"
touch -d @1700000000 "$profile/incremental/unit-0abc/s-a-b-c"
node --input-type=module -e 'import {writeFileSync} from "node:fs";import {join} from "node:path";writeFileSync(join(process.env.NTS_GATE_RUN_DIR,"summary.json"),JSON.stringify({identities:{commit:process.argv[1]},environment:{canonical:true},steps:[{name:"tooling",verdict:"PASS"}]}));' "$1"
`;
  candidateEnvironmentFixture(repo.root);
  repo.git(['add','-f','tooling']);repo.git(['commit','-qm','private environment']);
  const commit=repo.commit({".tool-versions":"nodejs 99.1.0\n","tooling/gate/pinned.sh":script},"retention run");
  const {slice}=fixtureToolingSlice(t);
  const lines:string[]=[],gate=pinnedGate(paths,repo.root,line=>lines.push(line),{nodeInstallations:installations,owned:{...ownMemory(join(repo.dir,'machine')),NTS_TOOLING_SLICE:slice},env:{...hostEnvironment(process.env),HOME:repo.dir}});
  const result=gate.run(commit,["tooling"],"retention");
  assert.equal(result.verdict,"green",JSON.stringify(result.reasons)+"\n"+lines.join("\n"));
  const unit=join(paths.target,"nts-dev/incremental/unit-0abc");
  assert.deepEqual(readdirSync(unit).sort(),["s-d-e-f","s-d-e.lock"]);
  assert.ok(lines.some(line=>line.startsWith(`incremental retention ${join(paths.target,"nts-dev")}: retained: kept 1 crate dirs, removed 0 and 1 older sessions`)),lines.join("\n"));
  assert.ok(lines.includes(`incremental retention ${join(paths.target,"clippy","debug")}: absent`),lines.join("\n"));
  // The gate-tree lock its builds ran under is free again once retention is done.
  const lock=GateResource.tryAcquire(paths.tree+".lock");assert.ok(lock);lock.close();
});

test('red full-check runs use the measured environment and release resolution sessions while the controller lives',async t=>{
  const repo=scratchRepo(t,'full-check-session'),paths=layout(repo.dir),installations=join(repo.dir,'installed');
  nodeInstallation(installations,process.versions.node,join(repo.dir,'nodes.jsonl'));
  candidateEnvironmentFixture(repo.root);candidateVersion(repo.root,'measured');
  const observed=join(repo.dir,'observed.json'),session=join(repo.dir,'retained-session');
  const subject=resolutionSubject(observed,session,1)+generatedJavaScript(`import {durableRecord as publishSummary} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};publishSummary(process.env.NTS_GATE_RUN_DIR+'/summary.json',{identities:{commit:process.argv[2]},environment:{canonical:true},steps:[{name:'tooling',verdict:'FAIL',reason:'private red control'}]});\n`);
  const script=`#!/bin/sh
if [ -n "$NTS_GATE_SETUP_ONLY" ];then
  mkdir -p "$NTS_GATE_TREE"
  git archive "$1" | tar -x -C "$NTS_GATE_TREE"
  exit 0
fi
[ "$1" = --environment-ready ] && shift
exec node "$NTS_GATE_TREE/subject.ts" "$1"
`;
  repo.git(['add','-f','tooling','.tool-versions']);repo.git(['commit','-qm','measured environment']);
  const commit=repo.commit({'tooling/gate/pinned.sh':script,'subject.ts':subject},'red measured command');
  const {slice}=fixtureToolingSlice(t);
  const lines:string[]=[];
  const gate=pinnedGate(paths,repo.root,line=>lines.push(line),{nodeInstallations:installations,owned:{...ownMemory(join(repo.dir,'machine')),NTS_TOOLING_SLICE:slice},env:{...hostEnvironment(process.env),HOME:repo.dir,NTS_TOOLING_SLICE:slice}});
  for(const label of ['core','core-probe','wide']){
    lines.length=0;
    const measured=gate.run(commit,['tooling'],label);
    // A verdict other than red names its cause: the controller's lines and the run's own log.
    let log:string;try{log=readFileSync(join(measured.run,'full-check.log'),'utf8');}catch(error){log=`no full-check.log: ${String(error)}`;}
    assert.equal(measured.verdict,'red',`${label}: ${JSON.stringify(measured.reasons)}\n${lines.join('\n')}\n--- ${join(measured.run,'full-check.log')}\n${log.slice(-8000)}`);
    const value=JSON.parse(readFileSync(observed,'utf8'));assert.equal(value.version,'measured');assert.equal(value.canonical,true);
    await assertSessionClosed(observed);
    // Each run gets a distinct resolution directory just like production.
    rmSync(session,{recursive:true});
  }
});

test('the real pinned wrapper preserves the tree lock across candidate environment creation and consumes its handoff',async t=>{
  const repo=scratchRepo(t,'full-check-pinned-session'),paths=layout(repo.dir),installations=join(repo.dir,'installed');
  candidateEnvironmentFixture(repo.root);
  // The repository starts with a committed private linker; stage before restoring it.
  const linker=join(repo.root,'tooling/inputs/link.sh'),privateLinker=readFileSync(linker);
  rmSync(linker);
  copyModuleClosure(['tooling/inputs/linker.ts','tooling/gate/admit.ts','tooling/gate/cargo.ts','tooling/gate/affinity/main.ts'],repo.root);
  writeFileSync(linker,privateLinker);
  assert.deepEqual(readFileSync(linker),privateLinker,"the pinned-wrapper fixture owns its no-op linker");
  writeFileSync(join(repo.root,'tooling/gate/affinity/main.ts'),'');
  const observed=join(repo.dir,'observed.json'),session=join(repo.dir,'retained-session'),bin=join(repo.dir,'bin');mkdirSync(bin);
  const cargo=join(bin,'cargo');writeFileSync(cargo,'#!/bin/sh\nmkdir -p "$CARGO_TARGET_DIR/release"\nprintf "#!/bin/sh\\n" > "$CARGO_TARGET_DIR/release/nts"\n');chmodSync(cargo,0o755);
  writeFileSync(join(bin,'rustup'),'#!/bin/sh\nprintf \'no overrides\\n\'\n',{mode:0o755});
  nodeInstallation(installations,process.versions.node,join(repo.dir,'nodes.jsonl'));
  const subject=resolutionSubject(observed,session,1)+generatedJavaScript(`import assert from 'node:assert/strict';assert.equal(process.env.NTS_GATE_LOCK_FD,undefined);\nimport {GateResource} from ${JSON.stringify(new URL('../gate/gate-resource.ts',import.meta.url).href)};assert.equal(GateResource.tryAcquire(process.env.NTS_GATE_TREE+'.lock'),null);\nimport {durableRecord as publishSummary} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};publishSummary(process.env.NTS_GATE_RUN_DIR+'/summary.json',{identities:{commit:process.argv[2]},environment:{canonical:true},steps:[{name:'tooling',verdict:'FAIL'}]});\n`);
  repo.git(['add','-f','tooling','.tool-versions']);repo.git(['commit','-qm','private candidate inputs']);
  const script=readFileSync(new URL('../gate/pinned.sh',import.meta.url),'utf8');
  const commit=repo.commit({'tooling/gate/pinned.sh':script,'subject.ts':subject,'tooling/gate/all.sh':`#!/bin/sh\nif [ "$1" = --list ];then echo tooling; exit 0;fi\nexec node subject.ts "$(git rev-parse HEAD)"\n`},'real pinned control');
  const lines:string[]=[],gate=pinnedGate(paths,repo.root,line=>lines.push(line),{nodeInstallations:installations,env:{...hostEnvironment(process.env),...ownMemory(join(repo.dir,'machine')),HOME:repo.dir,CARGO_HOME:repo.dir}});
  const result=gate.run(commit,['tooling'],'core');assert.equal(result.verdict,'red',JSON.stringify(result.reasons)+'\n'+lines.join('\n')+'\n'+readFileSync(join(result.run,'full-check.log'),'utf8'));
  await assertSessionClosed(observed);
  const lock=GateResource.tryAcquire(paths.tree+'.lock');assert.ok(lock,'the run releases the tree lock');lock.close();
  assert.equal(existsSync(join(result.run,'summary.json')),true);
  const busy=GateResource.tryAcquire(paths.tree+'.lock')!;
  try{
    const held=gate.run(commit,['tooling'],'busy');assert.equal(held.verdict,'held');
    assert.match(held.reasons.tooling!,/full-check gate tree is in use/);
  }finally{busy.close();}
});

test('the current pinned parent refuses historical configuration and releases its tree lock',t=>{
  const repo=scratchRepo(t,'full-check-historical-cargo'),paths=layout(repo.dir),installations=join(repo.dir,'installed');
  candidateEnvironmentFixture(repo.root);nodeInstallation(installations,process.versions.node,join(repo.dir,'nodes.jsonl'));
  const marker=join(repo.dir,'historical-completed'),config=join(paths.home,'.cargo/config.toml');
  const script=`#!/bin/sh
if [ -n "$NTS_GATE_SETUP_ONLY" ];then
  mkdir -p "$NTS_GATE_TREE"
  git archive "$1" | tar -x -C "$NTS_GATE_TREE"
  exit 0
fi
[ "$1" = --environment-ready ] && shift
exec node "$NTS_GATE_TREE/subject.ts" "$1"
`;
  const subject=generatedJavaScript(`import {mkdirSync,writeFileSync} from 'node:fs';import {dirname} from 'node:path';
import {durableRecord} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};
durableRecord(process.env.NTS_GATE_RUN_DIR+'/summary.json',{identities:{commit:process.argv[2]},environment:{canonical:true},steps:[{name:'tooling',verdict:'PASS'}]});
mkdirSync(dirname(${JSON.stringify(config)}),{recursive:true});writeFileSync(${JSON.stringify(config)},'');writeFileSync(${JSON.stringify(marker)},'drained');\n`);
  repo.git(['add','-f','tooling','.tool-versions']);repo.git(['commit','-qm','private historical environment']);
  const commit=repo.commit({'tooling/gate/pinned.sh':script,'subject.ts':subject},'historical command');
  const {slice}=fixtureToolingSlice(t);
  const gate=pinnedGate(paths,repo.root,()=>{},{nodeInstallations:installations,owned:{...ownMemory(join(repo.dir,'machine')),NTS_TOOLING_SLICE:slice},env:{...hostEnvironment(process.env),HOME:repo.dir,NTS_TOOLING_SLICE:slice}});
  mkdirSync(join(paths.home,'.cargo'),{recursive:true});writeFileSync(config,'');
  const before=gate.run(commit,['tooling'],'before');assert.equal(before.verdict,'held');assert.ok(before.reasons.tooling?.includes(config),JSON.stringify(before.reasons));
  assert.equal(existsSync(marker),false);rmSync(config);
  const after=gate.run(commit,['tooling'],'after');assert.equal(readFileSync(marker,'utf8'),'drained');assert.equal(after.verdict,'held');
  assert.ok(after.reasons.tooling?.includes(config),JSON.stringify(after.reasons));
  const lock=GateResource.tryAcquire(paths.tree+'.lock');assert.ok(lock,'a post-drain refusal releases the pinned tree lock');lock.close();
});

test("each step's verdict, as the full check reads it", t => {
  const run = summary(t, { verdict: "red", identities: { commit: COMMIT.slice(0, 12) }, environment: { canonical: true }, steps });
  const read = readSummary(run, COMMIT, [...steps.map(s => s.name), "missing"]);
  assert.deepEqual(read.steps, { build: "PASS", tests: "FAIL", "on-device": "PASS", dex: "HELD", rc: "HELD", llvm: "HELD", missing: "HELD" });
  assert.equal(read.reasons.tests, "FAIL: exit 1");
  assert.equal(read.reasons.missing, "not in the summary");
  assert.equal(verdictOf(read.steps), "red");
  assert.equal(verdictOf({ build: "PASS", rc: "HELD" }), "held");
  assert.equal(verdictOf({ build: "PASS", "on-device": "PASS" }), "green");
});

test("a summary that cannot vouch for the commit holds every step", t => {
  const other = summary(t, { identities: { commit: "ffffffffffff" }, environment: { canonical: true }, steps });
  assert.deepEqual(new Set(Object.values(readSummary(other, COMMIT, ["build"]).steps)), new Set(["HELD"]));
  const experiment = summary(t, { identities: { commit: COMMIT }, environment: { canonical: false }, steps });
  assert.equal(readSummary(experiment, COMMIT, ["build"]).reasons.build, "the run was not in the canonical environment");
  const broken = summary(t, "{ not json");
  assert.match(readSummary(broken, COMMIT, ["build"]).reasons.build!, /^unreadable summary/);
  assert.equal(readSummary(join(broken, "absent"), COMMIT, ["build"]).reasons.build, "the run wrote no summary");
});

test("a platform's programs left unrun pass while the policy lets it stay unrun, and hold their step when it does not", t => {
  const run = summary(t, { verdict: "green", identities: { commit: COMMIT }, environment: { canonical: true },
    steps: [{ name: "interop", verdict: "PASS" }, { name: "examples", verdict: "PASS" }] });
  const macos = "macos-hello      skipped: SKIP macos-hello: not run -- no Mac reachable (tooling/apple/vm.md)";
  const windows = "winui-hello      skipped: SKIP winui-hello: no Windows SDK";
  writeFileSync(join(run, "interop.log"), `  linux-hello      ok\n  ${macos}\n  ${windows}\n  16 built and ran, 2 skipped\n`);
  // The same line in a step that runs no platform's programs says nothing of them.
  writeFileSync(join(run, "examples.log"), `${macos}\n`);
  const both = ["interop", "examples"];
  assert.deepEqual(readSummary(run, COMMIT, both), { steps: { interop: "PASS", examples: "PASS" }, reasons: {} }, "both platforms may stay unrun today");
  const narrower = readSummary(run, COMMIT, both, { platforms: ["windows"], policy: "a narrower policy" });
  assert.deepEqual(narrower.steps, { interop: "HELD", examples: "PASS" });
  assert.equal(narrower.reasons.interop, `apple programs did not run, and a narrower policy lets only windows stay unrun: ${macos}`);
  const none = readSummary(run, COMMIT, both, { platforms: [], policy: "a policy" });
  assert.equal(none.reasons.interop, [macos, windows].map((line, i) => `${["apple", "windows"][i]} programs did not run, and a policy lets no platform stay unrun: ${line}`).join("; "));
  assert.equal(verdictOf(none.steps), "held");
});


test('a named controller stop interrupts an active synchronous pinned measurement',async t=>{
  const repo=scratchRepo(t,'full-check-active-stop'),paths=layout(repo.dir),installations=join(repo.dir,'installed');
  candidateEnvironmentFixture(repo.root);
  nodeInstallation(installations,process.versions.node,join(repo.dir,'nodes.jsonl'));
  const ready=join(repo.dir,'active.json'),outcome=join(repo.dir,'interrupted.json');
  const body=generatedJavaScript(`import {writeFileSync} from 'node:fs';
import {durableRecord} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};
import {runAsCommand,registerCommandCloser} from ${JSON.stringify(new URL('../differential/command-entry/main.ts',import.meta.url).href)};
runAsCommand(import.meta.url,async()=>{
  const timer=setInterval(()=>{},1000);
  registerCommandCloser('active measurement child',{close:()=>{clearInterval(timer);writeFileSync(${JSON.stringify(ready)}+'.closed','closed');}});
  durableRecord(${JSON.stringify(ready)},{slice:process.env.NTS_TOOLING_SLICE});
  await new Promise(()=>{});
});`);
  const script=`#!/bin/sh
if [ -n "$NTS_GATE_SETUP_ONLY" ];then
  mkdir -p "$NTS_GATE_TREE"
  git archive "$1" | tar -x -C "$NTS_GATE_TREE"
  exit 0
fi
[ "$1" = --environment-ready ] && shift
exec node "$NTS_GATE_TREE/subject.ts"
`;
  repo.git(['add','-f','tooling','.tool-versions']);repo.git(['commit','-qm','private active-stop environment']);
  const commit=repo.commit({'tooling/gate/pinned.sh':script,'subject.ts':body},'active measurement');
  const file=join(repo.dir,'controller.mjs'),env={...hostEnvironment(process.env),...ownMemory(join(repo.dir,'machine')),HOME:repo.dir};
  writeFileSync(file,generatedJavaScript(`import {durableRecord} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};
import {pinnedGate} from ${JSON.stringify(new URL('./measure.ts',import.meta.url).href)};
import {waitForControllerCycle} from ${JSON.stringify(new URL('./service.ts',import.meta.url).href)};
import {runAsCommand} from ${JSON.stringify(new URL('../differential/command-entry/main.ts',import.meta.url).href)};
runAsCommand(import.meta.url,async()=>{
  const result=pinnedGate(${JSON.stringify(paths)},${JSON.stringify(repo.root)},console.log,{nodeInstallations:${JSON.stringify(installations)},env:${JSON.stringify(env)}}).run(${JSON.stringify(commit)},['tooling'],'core');
  durableRecord(${JSON.stringify(outcome)},result);
  await waitForControllerCycle(60_000);
});`));
  const unit='nts-test-controller-active-'+randomUUID();let output='',ended=false;
  const child=spawn('systemd-run',['--user','--wait','--pipe','--collect','--unit='+unit,
    '-p','KillMode=control-group','-p','TimeoutStopSec=120s','-p','LimitCORE=0','-p','Nice=19',
    '--','taskset','-c','0-3,6-31',process.execPath,file],{env:hostEnvironment(process.env),stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{ended=true;resolve(code);});});
  let slice:string|undefined;
  try{
    await waitFor('the actual pinned measurement to enter its body',()=>existsSync(ready),{stopped:()=>ended?output:undefined});
    slice=(JSON.parse(readFileSync(ready,'utf8')) as {slice:string}).slice;
    const stopped=spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});assert.equal(stopped.status,0,stopped.stderr);
    assert.equal(await closed,143,output);
    assert.equal(readFileSync(ready+'.closed','utf8'),'closed','the measured child drains on the unit stop');
    assert.equal((JSON.parse(readFileSync(outcome,'utf8')) as {verdict:string}).verdict,'held','interruption never becomes a product verdict');
    const state=spawnTest('systemctl',['--user','show',slice,'-p','ActiveState'],{encoding:'utf8'});
    assert.match(state.stdout,/^ActiveState=inactive$/m,'the owned measurement slice stops with its controller');
    console.log('active measurement stop drained '+unit+'; controller exit143; interrupted verdict held; slice inactive');
    const lock=GateResource.tryAcquire(paths.tree+'.lock');assert.ok(lock,'synchronous launch releases its tree lock');lock.close();
    assert.doesNotMatch(output,/wedged drain|timed out|Killing/);
  }finally{
    spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});if(slice)stopToolingSlice(slice);await closed;
  }
});


const censusDetails = censusReport;

test("census failure identity retains complete verdict detail, independent of order and progress", () => {
  const a = "test/split/separator-undef.js: pass -> no-verdict (crash)", b = "test/other.js: pass -> refused";
  const expected = [JSON.stringify(["REGRESSED", a]), JSON.stringify(["REGRESSED", b])].sort();
  assert.deepEqual(censusFailureIdentity(censusDetails([a, b])), expected);
  assert.deepEqual(censusFailureIdentity("progress 40/40\n" + censusDetails([b, a]) + "\nworker time 200 s"), expected);
  assert.notDeepEqual(censusFailureIdentity(censusDetails([a], "CHANGED")), censusFailureIdentity(censusDetails([a])));
  assert.notDeepEqual(censusFailureIdentity(censusDetails([a.replace("crash", "refused")])) , censusFailureIdentity(censusDetails([a])));
});

test("census failure identity refuses truncated, missing and unrelated failure detail", () => {
  const complete = censusDetails(["test/a.js: pass -> no-verdict (crash)"]);
  for (const text of ["exit 1", "", complete.replace("1  REGRESSED", "21  REGRESSED"),
    complete.replace("test/a.js: pass -> no-verdict (crash)", "... 1 more"),
    complete.slice(0, complete.indexOf("  NOT RECONCILED:")),
    complete.replace("         0  CHANGED\n", ""),
    complete + "\n  NOT RECONCILED: the exclusion audit failed"]) {
    assert.equal(censusFailureIdentity(text), undefined, text);
  }
});

test("failed measurement summaries expose case identity to the production probe adapter", t => {
  const run = summary(t, { identities: { commit: COMMIT }, environment: { canonical: true },
    steps: [{ name: "test262-llvm", verdict: "FAIL", reason: "exit 1" }] });
  const log = censusDetails(["test/split/separator-undef.js: pass -> no-verdict (crash)"]);
  writeFileSync(join(run, "test262-llvm.log"), log);
  assert.deepEqual(readSummary(run, COMMIT, ["test262-llvm"]).failures, { "test262-llvm": censusFailureIdentity(log) });
});


test("the real recorded-C census filter preserves failure identities, failure status and the measurement count guard", t => {
  for (const category of ["REGRESSED", "CHANGED", "MISSING"]) {
    const raw = censusReport(["test/split/separator-undef.js: pass -> no-verdict (crash)"], category);
    const filtered = recordedCensus(t, raw);
    assert.equal(filtered.status, 1, filtered.stdout + filtered.stderr);
    assert.match(filtered.stdout, /^  against results\/fixture.tsv:$/m);
    assert.doesNotMatch(filtered.stdout, /census start:/);
    const identity = censusFailureIdentity(raw); assert.ok(identity);
    assert.deepEqual(censusFailureIdentity(filtered.stdout), identity, `${category}: raw and actual filtered identities agree`);
  }
  const green = "  pass-count: 1\n  negatives-accepted: 0\n  reconciled\n";
  assert.equal(recordedCensus(t, green, 0).status, 0, "measured passing control");
  const missing = recordedCensus(t, green.replace("  pass-count: 1\n", ""), 0);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /no pass-count line: the run measured nothing/);
});
