import {fixtureEnvironment} from "./test-environment.ts";
// First-run job accounting, through the real CLI in owned units. The watcher
// publishes its observed peak, which is the event releasing the held command.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { gateEnvironment } from "./canonical-environment.ts";
import { jobSizing, ledgerStatus, readLedger } from "./memory-ledger.ts";
import { readCostHistory,historyFile,writeCostHistory, peakReservation } from "./step-scheduling.ts";
import { removable } from "./run-temporary.ts";
import { ownMemory } from "./test-memory.ts";
import { newTestScratch } from "./test-scratch.ts";
import { waitFor } from "./test-wait.ts";
import { toolingSliceArgs,stopToolingSlice } from "./tooling-slice.ts";
import {GateScopes} from "./scopes/step-scope.ts";
import {peakWatcherScope,peakWatcherFlushScope} from "./memory-watch-scope.ts";
import type {HostObservationFixture} from "./host-observations.ts";
import {assignTestValues} from "./test-environment.ts";

const ADMIT = fileURLToPath(new URL("./admit.ts", import.meta.url));
const MiB = 2 ** 20;

function fixture(t: TestContext,resident:HostObservationFixture["resident"]={kind:"live"}) {
  const root = newTestScratch("job-live-memory"), units: string[] = [];
  const memory = ownMemory(join(root, "memory"), { availableKiB: 2.5 * 2 ** 20, totalKiB: 32 * 2 ** 20,resident });
  const env = gateEnvironment(fixtureEnvironment(t,{NTS_MEMORY_RESERVATION:undefined}), { run: join(root, "canonical"), standalone: true, owned: memory }).env;
  const scopes=new GateScopes(env);assignTestValues(env,{NTS_TOOLING_SLICE:scopes.slice});
  t.after(() => {
    for (const unit of units) spawnSync("systemctl", ["--user", "stop", unit], {env:fixtureEnvironment(t), stdio: "ignore" });
    stopToolingSlice(scopes.slice);
    removable(root); rmSync(root, { recursive: true, force: true });
  });
  const start = (body: string, args: string[] = [],options:{properties?:string[];owned?:NodeJS.ProcessEnv}={}) => {
    const unit = `nts-test-live-job-${randomUUID()}`; units.push(unit);
    const setenv = Object.entries({...env,...options.owned}).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([key, value]) => `--setenv=${key}=${value}`);
    const child = spawn("systemd-run", ["--user", ...toolingSliceArgs(env), `--unit=${unit}`, "--collect", "--quiet", "--wait", "--pipe",
      "--property=LimitCORE=0", "--property=Nice=19", "--property=CPUAffinity=0-3 6-31", "--property=TimeoutStopSec=5s", "--property=RuntimeMaxSec=300s",
      ...(options.properties??[]),...setenv, process.execPath, ADMIT, "--key", "perf-count", "--", process.execPath, "-e", body, ...args], {env:fixtureEnvironment(t), stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.setEncoding("utf8").on("data", data => { out += data; }); child.stderr.setEncoding("utf8").on("data", data => { err += data; });
    return { unit,done: once(child, "close"), ended: () => child.exitCode !== null ? `unit exited ${child.exitCode}: ${err}` : undefined,
      get stdout() { return out; }, get stderr() { return err; } };
  };
  return { root, memory, start,env,slice:scopes.slice };
}

test("an unknown CLI job starts beside a large unrelated history, is charged live, records its peak at unit exit and uses it next time", async t => {
  const f = fixture(t), release = join(f.root, "release"), ready = join(f.root, "ready");
  mkdirSync(f.memory.NTS_GATE_COSTS_DIR, { recursive: true });
  const history = historyFile(f.memory);
  assert.equal(writeCostHistory(history,{jobs:[{key:"unrelated",basis:"job",peak:12*2**30,width:1}]}),undefined);
  writeFileSync(release, "");
  assert.deepEqual([jobSizing({ key: "perf-count" }, f.memory).bytes, jobSizing({ key: "perf-count" }, f.memory).basis], [0, "live"]);
  const first = f.start("const fs=require('node:fs'),held=Buffer.alloc(160*2**20,1);const watcher=fs.watch(process.argv[1],()=>watcher.close());fs.writeFileSync(process.argv[2],'ready');process.on('exit',()=>process.stdout.write(String(held.length)));", [release, ready]);
  await waitFor("the live command and its watcher to observe the allocation", () => existsSync(ready)
    && (readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.find(entry => entry.live)?.sampledPeak ?? 0) >= 160 * MiB, { stopped: first.ended });
  const status = ledgerStatus({ env: f.memory }), entry = status.admitted.find(entry => entry.live)!;
  assert.equal(entry.liveUse, true);
  assert.equal(entry.bytes, peakReservation([entry.used_bytes]));
  assert.equal(status.pending_bytes, entry.bytes - entry.used_bytes);
  assert.ok(entry.bytes < 512 * MiB, "the unrelated 12GiB peak was never reserved");
  writeFileSync(release, "finish");
  assert.deepEqual(await first.done, [0, null], first.stderr);
  const measured = readCostHistory(history).jobs.get("perf-count")!;
  assert.ok(measured?.observations.at(-1)!.peak >= 160 * MiB, "unit exit flushes the observed peak");
  assert.equal(first.stdout, String(160 * MiB));
  assert.deepEqual([jobSizing({ key: "perf-count" }, f.memory).basis, jobSizing({ key: "perf-count" }, f.memory).bytes], ["measured", peakReservation(measured.observations.map(row=>row.peak))]);
  const second = f.start("const fs=require('node:fs'),path=require('node:path');const entry=JSON.parse(fs.readFileSync(path.join(process.env.NTS_MEMORY_LEDGER,'admitted',process.env.NTS_MEMORY_RESERVATION+'.json'),'utf8'));process.stdout.write(JSON.stringify({live:entry.liveUse??false,bytes:entry.bytes}));");
  assert.deepEqual(await second.done, [0, null], second.stderr);
  assert.deepEqual(JSON.parse(second.stdout), { live: false, bytes: peakReservation(measured.observations.map(row=>row.peak)) });
});


function historyLock(t:TestContext,f:ReturnType<typeof fixture>,mode:'hold'|'fail'){
 const bin=join(f.root,'bin'),locked=join(f.root,'history-locked'),unlock=join(f.root,'history-unlock');mkdirSync(bin);
 writeFileSync(join(bin,'flock'),`#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);
if(args[0]==='-w'&&${mode==='fail'}){process.stderr.write('fixture history lock failure');process.exit(69);}
const result=cp.spawnSync('/usr/bin/flock',args,{env:{},stdio:['ignore','ignore','pipe',null,null,null,null,null,8],encoding:'utf8'});
if(result.status!==0){process.stderr.write(result.stderr||'');process.exit(result.status??2);}
if(args[0]!=='-w')process.exit(0);
fs.writeFileSync(${JSON.stringify(locked)},'locked');
const check=()=>{if(fs.existsSync(${JSON.stringify(unlock)})){watch.close();process.exit(0);}};
const watch=fs.watch(${JSON.stringify(f.root)},check);check();
`,{mode:0o755});
 return {locked,unlock,owned:{PATH:bin+':'+fixtureEnvironment(t).PATH}};
}

const HELD_COMMAND="const fs=require('node:fs');const watch=fs.watch(process.argv[1],()=>watch.close());fs.writeFileSync(process.argv[2],'ready');";
async function observeOwnedPeak(f:ReturnType<typeof fixture>,ready:string,stopped:()=>string|undefined){
 await waitFor('command entry and its admitted identity',()=>existsSync(ready)&&readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.length===1,{stopped});
 const entry=readLedger(f.memory.NTS_MEMORY_LEDGER).admitted[0]!,group=entry.measure.cgroup!.path;
 ownMemory(join(f.root,'memory'),{resident:{kind:'fixed',defaultBytes:0,cgroups:{[group]:160*MiB}}});
 await waitFor('the supplied peak is published by the real watcher',()=>readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.some(row=>(row.sampledPeak??0)>=160*MiB),{stopped});
 return entry.id;
}

test('stopping a command during its exit write keeps the peak in a fresh bounded sibling flush scope',async t=>{
 const f=fixture(t,{kind:'fixed',defaultBytes:0}),lock=historyLock(t,f,'hold'),release=join(f.root,'release'),ready=join(f.root,'ready');writeFileSync(release,'');
 const run=f.start(HELD_COMMAND,[release,ready],{properties:['--property=RemainAfterExit=yes'],owned:lock.owned});
 try{
  const id=await observeOwnedPeak(f,ready,run.ended);writeFileSync(release,'finish');
  await waitFor('the exit writer owns its history lock',()=>existsSync(lock.locked),{stopped:run.ended});
  const flush=peakWatcherFlushScope(peakWatcherScope(id));
  const scope=spawnSync('systemctl',['--user','show',flush,'--property=Slice','--property=ControlGroup','--property=RuntimeMaxUSec'],{env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(scope.status,0,scope.stderr);assert.ok(scope.stdout.includes('Slice='+f.slice),scope.stdout);
  assert.ok(scope.stdout.includes('/'+flush),scope.stdout);assert.match(scope.stdout,/RuntimeMaxUSec=1min/);
  const stop=spawnSync('systemctl',['--user','stop',run.unit],{env:fixtureEnvironment(t),encoding:'utf8'});assert.equal(stop.status,0,stop.stderr);
  assert.equal(spawnSync('systemctl',['--user','is-active','--quiet',flush],{env:fixtureEnvironment(t)}).status,0,'the command stop cannot reach its flush');
  writeFileSync(lock.unlock,'continue');assert.deepEqual(await run.done,[0,null],run.stderr);
  const history=historyFile(f.memory);assert.equal(readCostHistory(history).jobs.get('perf-count')?.observations.at(-1)?.peak,160*MiB);
  await waitFor('the drained flush collects',()=>spawnSync('systemctl',['--user','is-active','--quiet',flush],{env:fixtureEnvironment(t)}).status!==0);
 }finally{writeFileSync(lock.unlock,'continue');}
});

test('a CLI peak history write failure is reported by key and cause',async t=>{
 const f=fixture(t,{kind:'fixed',defaultBytes:0}),lock=historyLock(t,f,'fail'),release=join(f.root,'release'),ready=join(f.root,'ready');writeFileSync(release,'');
 const run=f.start(HELD_COMMAND,[release,ready],{owned:lock.owned});
 await observeOwnedPeak(f,ready,run.ended);writeFileSync(release,'finish');assert.deepEqual(await run.done,[0,null],run.stderr);
 assert.match(run.stderr,/memory: perf-count's peak is not in its history:.*fixture history lock failure/);
 assert.equal(readCostHistory(historyFile(f.memory)).jobs.has('perf-count'),false);
});

test('an unavailable watcher scope refuses admission before executing the command',async t=>{
 const f=fixture(t,{kind:'fixed',defaultBytes:0}),entered=join(f.root,'must-not-execute'),bin=join(f.root,'bin');mkdirSync(bin);
 writeFileSync(join(bin,'systemd-run'),`#!${process.execPath}
process.stderr.write('fixture refused watcher scope');process.exit(69);
`,{mode:0o755});
 const run=f.start("require('node:fs').writeFileSync(process.argv[1],'entered')",[entered],{owned:{PATH:bin+':'+fixtureEnvironment(t).PATH}});
 assert.deepEqual(await run.done,[125,null],run.stderr);assert.match(run.stderr,/memory: perf-count's peak watcher scope .* could not start/);
 assert.equal(existsSync(entered),false);assert.equal(readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.length,0,'refused setup releases its reservation');
});
