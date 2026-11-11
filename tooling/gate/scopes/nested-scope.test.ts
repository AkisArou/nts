import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { cpuList } from "../affinity.ts";
import { gateEnvironment } from "../canonical-environment.ts";
import { spawnTest, waitFor } from "../test-wait.ts";
import { GateScopes, type StepScope } from "./step-scope.ts";
import { newTestScratch } from "../test-scratch.ts";
import { ownMemory } from "../test-memory.ts";

test("nested census scopes belong to one step and another run remains live when it drains", async t => {
  const own = newTestScratch("nested-step-scope-run");
  type Exit = { status: number | null; signal: NodeJS.Signals | null; output: string };
  const owners: GateScopes[] = [];
  const entries: { scope: StepScope; ready: string; release: string; metadata: string; done: Promise<Exit>; stopped: () => string | undefined; drained: boolean }[] = [];
  try {
    for (const label of ["a", "b"]) {
      const owner = new GateScopes(process.env); owners.push(owner);
      const scope = owner.step({ max: 2 ** 31 }), ready = join(own, `${label}.json`), release = join(own, `${label}.release`), workerReady = join(own, `${label}.worker.json`), metadata = join(own, `${label}.owner.json`);
      const publish=JSON.stringify(new URL("../durable-record.ts",import.meta.url).href);
      const childSource = `import {readFileSync,watch,existsSync} from 'node:fs';import {durableRecord} from ${publish};
durableRecord(${JSON.stringify(workerReady)},{group:readFileSync('/proc/self/cgroup','utf8'),cpus:/^Cpus_allowed_list:\\s+(.+)$/m.exec(readFileSync('/proc/self/status','utf8'))[1]});
watch(${JSON.stringify(own)},()=>{if(existsSync(${JSON.stringify(release)}))process.exit(0);});`;
      const source = `import {readFileSync,existsSync,watch} from 'node:fs';import {spawn} from 'node:child_process';import {durableRecord} from ${publish};
import {MemoryRun} from ${JSON.stringify(new URL("../../census/worker-memory.ts", import.meta.url).href)};
const memory=new MemoryRun({budgetBytes:128*2**20,id:'nested-scope-control'});
durableRecord(${JSON.stringify(metadata)},{directory:memory.directory});
const until=path=>existsSync(path)?Promise.resolve():new Promise(resolve=>{const w=watch(${JSON.stringify(own)},()=>{if(existsSync(path)){w.close();resolve();}});if(existsSync(path)){w.close();resolve();}});
try{const worker=memory.worker(0,64*2**20),bound=worker.scope(process.execPath,['--input-type=module','-e',${JSON.stringify(childSource)}]);
const child=spawn('systemd-run',bound.argv,{env:bound.env,stdio:['ignore','ignore','inherit']});
const ended=new Promise((_,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>reject(new Error('nested worker ended before ready: '+code+' '+signal)));});
await Promise.race([until(${JSON.stringify(workerReady)}),ended]);
durableRecord(${JSON.stringify(ready)},{census:memory.group,worker:JSON.parse(readFileSync(${JSON.stringify(workerReady)},'utf8')),lang:process.env.LANG,limits:readFileSync('/proc/self/limits','utf8')});
await until(${JSON.stringify(release)});
}finally{memory.close();}`;
      const launch = scope.command(process.execPath, ["--input-type=module", "-e", source]);
      const env = gateEnvironment(process.env, { run: join(own, `run-${label}`), owned: { NTS_TOOLING_SLICE: scope.slice } }).env;
      const child = spawn(launch.command, launch.args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "", exit: Exit | undefined;
      child.stdout.on("data", part => { output += part; }); child.stderr.on("data", part => { output += part; });
      const done = new Promise<Exit>((resolve, reject) => { child.once("error", reject); child.once("close", (status, signal) => { exit = { status, signal, output }; resolve(exit); }); });
      entries.push({ scope, ready, release, metadata, done, stopped: () => exit ? JSON.stringify(exit) : undefined, drained: false });
    }
    for (const entry of entries) await waitFor("nested census worker ready", () => existsSync(entry.ready), { stopped: entry.stopped });
    const [first, second] = entries;
    assert.ok(first && second);
    assert.notEqual(first.scope.slice, second.scope.slice);
    for (const entry of entries) {
      const actual = JSON.parse(readFileSync(entry.ready, "utf8")) as { census: string; worker: { group: string; cpus: string }; lang: string; limits: string };
      assert.ok(actual.census.startsWith(`${entry.scope.group}/`));
      assert.ok(actual.worker.group.trim().startsWith(`0::${actual.census}/`));
      assert.ok(!cpuList(actual.worker.cpus).includes(4) && !cpuList(actual.worker.cpus).includes(5));
      assert.equal(actual.lang, "C.UTF-8");
      assert.match(actual.limits, /^Max core file size\s+0\s+0\s+bytes/m);
    }
    first.scope.kill(); await first.done;
    const proof = await first.scope.drain(); first.drained = true;
    assert.equal(proof.populated, 0);
    assert.match(readFileSync(`/sys/fs/cgroup${second.scope.group}/cgroup.events`, "utf8"), /^populated 1$/m, "one run cannot drain another run's scope");
    assert.equal(second.stopped(), undefined);
    t.diagnostic(JSON.stringify({ first: proof, secondLiveGroup: second.scope.group }));
    writeFileSync(second.release, "finish normally");
    const ended = await second.done; assert.equal(ended.status, 0, ended.output); assert.equal(ended.signal, null);
    assert.equal((await second.scope.drain()).populated, 0); second.drained = true;
  } finally {
    for (const entry of entries) if (!entry.drained) { entry.scope.kill(); await entry.done; await entry.scope.drain(); }
    for (const owner of owners) owner.close();
    for (const entry of entries) if (existsSync(entry.metadata)) {
      const { directory } = JSON.parse(readFileSync(entry.metadata, "utf8")) as { directory: string };
      assert.equal(dirname(directory), join(homedir(), ".cache/nts/worker-memory"));
      assert.match(basename(directory), /^ntsc[a-f0-9]{16}$/);
      rmSync(directory, { recursive: true, force: true });
    }
    rmSync(own, { recursive: true, force: true });
  }
});

test("active, compiled, shell-case and counted commands enter sibling group-OOM worker scopes", async t => {
  const own = newTestScratch("worker-shape-layout"), owner = new GateScopes(process.env);
  const step = owner.step({ max: 2 ** 30 });
  const probe = 'const fs=require("node:fs"); const group=fs.readFileSync("/proc/self/cgroup","utf8").trim().replace(/^0::/,""); console.log(JSON.stringify({group,oom:fs.readFileSync("/sys/fs/cgroup"+group+"/memory.oom.group","utf8").trim()}));';
  const script = `
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {activeCommand} from ${JSON.stringify(new URL("../active-command.ts", import.meta.url).href)};
import {MemoryRun,compileSync,compileActive,closeMemoryRun} from ${JSON.stringify(new URL("../../census/worker-memory.ts", import.meta.url).href)};
import {runCaseBound} from ${JSON.stringify(new URL("../case-bound.ts", import.meta.url).href)};
import {runIntegrityListing} from ${JSON.stringify(new URL("../../conformance/integrity-command.ts", import.meta.url).href)};
const probe=${JSON.stringify(probe)}, args=["-e",probe], options={cwd:process.cwd(),env:process.env};
const rows=[];
const active=await activeCommand(process.execPath,args,options);
if(active.status!==0)throw Error(active.stderr);
rows.push({kind:"active",...JSON.parse(active.stdout)});
const synchronous=compileSync({memoryCapKb:256*1024},process.execPath,args,{...options,encoding:"utf8"});
if(synchronous.status!==0)throw Error(synchronous.stderr);
rows.push({kind:"synchronous compile",...JSON.parse(synchronous.stdout)});
const compiled=await compileActive({memoryCapKb:256*1024},process.execPath,args,options);
if(compiled.status!==0)throw Error(compiled.stderr);
rows.push({kind:"active compile",...JSON.parse(compiled.stdout)});
let caseOutput="";
const status=await runCaseBound({command:process.execPath,args,cpuSeconds:30,idleMs:30000},process.env,
  {out:text=>{caseOutput+=text;},err:text=>{process.stderr.write(text);}});
if(status!==0)throw Error("case command exited "+status);
rows.push({kind:"shell case",...JSON.parse(caseOutput)});
const counted=await runIntegrityListing(process.execPath,args,{...options,counterFile:${JSON.stringify(join(own, "counter.txt"))}});
if(counted.status!==0||counted.counter_error)throw Error(counted.stderr+" "+counted.counter_error);
rows.push({kind:"counted",...JSON.parse(counted.stdout)});
const outer=new MemoryRun({budgetBytes:256*2**20,id:"outer-case"}),worker=outer.worker("nested",128*2**20);
const nestedSource=${JSON.stringify(`
import {spawnSync} from "node:child_process";
import {MemoryRun} from ${JSON.stringify(new URL("../../census/worker-memory.ts", import.meta.url).href)};
for(const name of Object.keys(process.env))if(name.startsWith("NTS_CENSUS_"))delete process.env[name];
const inner=new MemoryRun({budgetBytes:256*2**20,id:"nested-case"}),worker=inner.worker(0,256*2**20);
try {
  const scope=worker.scope(process.execPath,["-e",${JSON.stringify(probe)}]);
  const result=spawnSync("systemd-run",scope.argv,{env:scope.env,encoding:"utf8"});
  if(result.status!==0)throw Error(result.stderr);
  console.log(JSON.stringify({...JSON.parse(result.stdout),effective:inner.effectiveBudgetBytes()}));
}finally{inner.close();}
`)};
try {
  const scope=worker.scope(process.execPath,["--input-type=module","-e",nestedSource]);
  const result=spawnSync("systemd-run",scope.argv,{env:scope.env,encoding:"utf8"});
  if(result.status!==0)throw Error(result.stderr);
  const nested=JSON.parse(result.stdout);
  if(!nested.group.startsWith(worker.group+"/")||nested.effective!==128*2**20)throw Error("nested command escaped its enclosing case cap");
  rows.push({kind:"nested case",...nested});
}finally{outer.close();}
closeMemoryRun();
console.log(JSON.stringify({supervisor:readFileSync("/proc/self/cgroup","utf8").trim().replace(/^0::/,""),rows}));
`;
  const launch = step.command(process.execPath, ["--input-type=module", "-e", script]);
  const env = gateEnvironment(process.env, { run: join(own, "run"), owned: {
    NTS_TOOLING_SLICE: step.slice, NTS_GATE_STEP_MEMORY_BYTES: String(2 ** 30),
    ...ownMemory(join(own, "memory")),
  } }).env;
  const child = spawn(launch.command, launch.args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", part => { output += part; });
  child.stderr.on("data", part => { output += part; });
  const ended = new Promise<{status:number|null;signal:NodeJS.Signals|null}>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
  t.after(async () => { step.kill(); await ended; await step.drain(); owner.close(); rmSync(own, { recursive: true, force: true }); });
  const result = await ended;
  assert.deepEqual(result, { status: 0, signal: null }, output);
  const observed = JSON.parse(output.trim().split("\n").at(-1)!) as {supervisor:string;rows:{kind:string;group:string;oom:string}[]};
  assert.ok(observed.supervisor.startsWith(step.supervisorGroup + "/"));
  assert.equal(observed.rows.length, 6);
  for (const row of observed.rows) {
    assert.ok(row.group.startsWith(step.workerGroup + "/"), row.kind + " escaped the worker boundary");
    assert.equal(row.oom, "1", row.kind + " lacks its group-OOM boundary");
  }
  const deepest = observed.rows.at(-1)!.group.split("/").filter(part => part.endsWith(".slice")).at(-1)!;
  assert.ok(Buffer.byteLength(deepest) <= 255, deepest);
  t.diagnostic(JSON.stringify({ nestedCaseSlice: deepest, bytes: Buffer.byteLength(deepest), sliceDepth: deepest.split("-").length - 1 }));
});

test("a tooling collector survives its workers exhausting their step boundary and records pressure", async t => {
  const own = newTestScratch("collector-worker-pressure"), owner = new GateScopes(process.env);
  const step = owner.step({ max: 256 * 2 ** 20 }), subject = join(own, "pressure.test.mjs");
  t.after(async () => { step.kill(); await step.drain(); owner.close(); rmSync(own, { recursive: true, force: true }); });
  writeFileSync(subject, 'import {test} from "node:test"; test("pressure",()=>{const held=[];for(;;)held.push(Buffer.alloc(16*2**20,1));});');
  const script = `
import {readFileSync} from "node:fs";
import {Writable} from "node:stream";
import {runScopedTooling} from ${JSON.stringify(new URL("../tooling-runner.ts", import.meta.url).href)};
import {PressureError} from ${JSON.stringify(new URL("../step-result.ts", import.meta.url).href)};
try {
  await runScopedTooling([${JSON.stringify(subject)}],{output:new Writable({write(_chunk,_encoding,done){done();}})});
  throw Error("the collector accepted an incomplete pressure run");
} catch(error) {
  if(!(error instanceof PressureError))throw error;
  console.log(JSON.stringify({reason:error.message,supervisor:readFileSync("/proc/self/cgroup","utf8").trim().replace(/^0::/,"")}));
}`;
  const launch = step.command(process.execPath, ["--input-type=module", "-e", script]);
  const env = gateEnvironment(process.env, { run: join(own, "run"), owned: {
    NTS_TOOLING_SLICE: step.slice, NTS_GATE_STEP_MEMORY_BYTES: String(256 * 2 ** 20),
    ...ownMemory(join(own, "memory")),
  } }).env;
  const result = spawnTest(launch.command, launch.args, { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.signal, null);
  const observed = JSON.parse(result.stdout.trim()) as {reason:string;supervisor:string};
  assert.ok(observed.supervisor.startsWith(step.supervisorGroup + "/"));
  assert.match(observed.reason, /tooling workers exceeded their step's memory bound/);
  assert.ok(step.memoryEvents().own_oom > 0, "the worker boundary retains its pressure event");
});
