import {declareOwnMembers} from '../gate/test-cgroup-members.ts';
import {testEnvironment,testEnvironmentHandoff,fixtureEnvironment} from "../gate/test-environment.ts";
import { hangDeadline, type HangDeadline, spawnTest, testProcessResult, TEST_HANG_MS, waitFor } from "../gate/test-wait.ts";
import assert from "node:assert/strict";
import { constants, closeSync, openSync, writeSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { capped } from "./attempt262.ts";
import { readLedger, reserve } from "../gate/memory-ledger.ts";
import { useOwnMemory,ownMemory as writeOwnMemory } from "../gate/test-memory.ts";
import {historyFile,writeCostHistory,peakReservation} from "../gate/step-scheduling.ts";
import {hostObservations} from "../gate/host-observations.ts";
import { createTokenPool } from "../gate/token-pool.ts";
import {releaseToken} from "../gate/case-context.ts";
import { tokenClient } from "../gate/tokens.mjs";
import { compileSync, compileActive, memoryCause, MemoryRun, memoryRun } from "./worker-memory.ts";
import { runMemoryWorkers } from "./worker-pool.ts";
import { newTestScratch } from "../gate/test-scratch.ts";
import {toolingSlice,toolingSliceArgs} from "../gate/tooling-slice.ts";
import {systemdEnvironment} from "../gate/environment.ts";
import {randomUUID} from "node:crypto";

// The pools here reserve their memory in a ledger of this file's own, against
// an 8 GiB reading, never the machine's.
const memoryDirectory = newTestScratch("resident-run-memory");
after(() => rmSync(memoryDirectory, { recursive: true, force: true }));
const ownMemory = useOwnMemory(memoryDirectory, { availableKiB: 8 * 2 ** 20, totalKiB: 32 * 2 ** 20 });
  declareOwnMembers(ownMemory,[process.pid]);
afterEach(() => {
  for (const [name, value] of Object.entries(ownMemory)) assert.equal(process.env[name], value, `a pool's release left ${name} as this file set it`);
});

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = join(HERE, "fixtures/resident-worker.ts");
const CGROUP = "/sys/fs/cgroup";
const scratch = () => {
  return newTestScratch("resident-run");
};
const kills = (group: string) => Number(/^oom_kill (\d+)$/m.exec(readFileSync(join(CGROUP, group, "memory.events"), "utf8"))![1]);

/**
 * A real gate token pool of `n` (token-pool.ts, as run.mjs serves it) and a
 * client of it as the resident pool's token policy, with the pool's own
 * request, grant, release and cancel counts.
 */
async function gatePool(n: number,attach?:Parameters<typeof createTokenPool>[0]['attach']) {
  const seen = { request: 0, grant: 0, release: 0, cancel: 0 };
  const history:{event:string;context?:unknown}[]=[];
  const pool: any = createTokenPool({width:n,
    attach,
    free: () => n - pool.total,
    claim: (_step: string, { waitedS }: { waitedS: number }) => waitedS,
    observe: (row: { event: string;context?:unknown }) => {
      const key = row.event.replace(/^token\./, "") as keyof typeof seen;
      if (key in seen) {seen[key]++;history.push({...row});}
    },
  });
  await pool.start();
  const client = tokenClient(pool.addr, "typescript-c");
  return {
    seen,
    history,
    waiting: () => pool.waiting.length as number,
    token: (path: string, signal: AbortSignal) => client.acquire({ project: path }, signal),
    /** Every control ends here: no token held, no request waiting. */
    settled: () => waitFor("every token returned and no request waiting", () => pool.total === 0 && pool.waiting.length === 0),
    close: async () => {pool.close();await pool.closed;},
  };
}

test("a resident pool requires an explicit token policy before setup", async () => {
  let closed = 0, setup = 0;
  const memory = { effectiveBudgetBytes: () => { setup++; return 1; }, close: () => { closed++; } } as unknown as MemoryRun;
  const options = { paths: [], jobs: 1, memory, workerBytes: 1, args: () => [], onRow: () => {} };
  // Model an untyped caller; typed callers must supply the required policy.
  await assert.rejects(runMemoryWorkers(options as Parameters<typeof runMemoryWorkers>[0]), /resident workers require an explicit token policy/);
  assert.equal(setup, 0, "a missing token policy fails before any worker or memory setup");
  assert.equal(closed, 1, "the pool still closes the run it owns");
});

test('a bounded resident pool recycles only after completed cases and returns every token',async t=>{
  const directory=scratch();t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const memory=new MemoryRun({budgetBytes:192*2**20,id:'completed-case-recycling'}),gate=await gatePool(1);
  t.after(gate.close);
  const rows:{path:string;pid:number;bucket:string}[]=[],paths=Array.from({length:8},(_,index)=>'safe-'+index);
  const options={paths,jobs:1,memory,workerBytes:128*2**20,recycleAfterCases:2,
    token:gate.token,
    args:(index:number)=>[fixture,directory,String(index)],onRow:(row:{path:string;pid:number;bucket:string})=>rows.push(row)};
  const summary=await runMemoryWorkers(options);
  assert.deepEqual(rows.map(row=>row.path),paths);
  const counts=new Map<number,number>();for(const row of rows)counts.set(row.pid,(counts.get(row.pid)??0)+1);
  assert.deepEqual([...counts.values()],[2,2,2,2],'each fresh process owns exactly its bounded completed window');
  assert.equal(summary.pressureRequeues,0);assert.equal(summary.idlePressureRestarts,0);
  assert.equal(summary.returnedOffers,0);
  assert.equal(rows.every(row=>row.bucket==='strict-pass'),true);
  await gate.settled();assert.equal(gate.seen.grant,paths.length);assert.equal(gate.seen.release,paths.length);
  assert.equal(existsSync(join(CGROUP,memory.group)),false,'all worker generations drain before the pool finishes');
});

test('a case that leaves its worker holding past the bound is followed by a fresh worker, and a case under it is not',async t=>{
  const directory=scratch();t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const memory=new MemoryRun({budgetBytes:192*2**20,id:'held-memory-recycling'}),gate=await gatePool(1);
  t.after(gate.close);
  const rows:{path:string;pid:number;bucket:string}[]=[],paths=Array.from({length:6},(_,index)=>'safe-'+index);
  // The worker's charge after each case: the third leaves 600 MiB behind.
  let answered=0;
  const charge=()=>++answered===3?600*2**20:100*2**20;
  const summary=await runMemoryWorkers({paths,jobs:1,memory,workerBytes:128*2**20,recycleAboveBytes:512*2**20,charge,
    token:gate.token,args:(index:number)=>[fixture,directory,String(index)],onRow:(row:{path:string;pid:number;bucket:string})=>rows.push(row)});
  assert.deepEqual(rows.map(row=>row.path),paths);
  const counts=new Map<number,number>();for(const row of rows)counts.set(row.pid,(counts.get(row.pid)??0)+1);
  assert.deepEqual([...counts.values()],[3,3],'only the case past the bound ends its worker');
  assert.equal(summary.pressureRequeues,0);
  await gate.settled();assert.equal(gate.seen.grant,paths.length);assert.equal(gate.seen.release,paths.length);
});

test("a real step records its aggregate memory.peak before the cgroup is removed", { timeout: TEST_HANG_MS }, t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const costs = join(directory, "costs"); mkdirSync(costs);
  const module = new URL("./worker-memory.ts", import.meta.url).href;
  const code = `import { MemoryRun } from ${JSON.stringify(module)};
import { readFileSync } from 'node:fs';
import {spawnTest} from ${JSON.stringify(new URL("../gate/test-wait.ts",import.meta.url).href)};
const run = new MemoryRun({ budgetBytes: 128 * 2 ** 20 });
let peak;
try {
 const worker = run.worker(0, 128 * 2 ** 20);
 const scope = worker.scope('python3', ['-c', 'held=bytearray(24*1024**2); print(len(held))']);
 const child = spawnTest('systemd-run', scope.argv, { env: scope.env, encoding: 'utf8',});
 if (child.status !== 0) throw new Error(child.stderr);
 peak = Number(readFileSync('/sys/fs/cgroup' + run.group + '/memory.peak', 'utf8'));
} finally { run.close(); }
console.log(JSON.stringify({ peak, group: run.group }));`;
  const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8",
    env: { ...fixtureEnvironment(t,writeOwnMemory(join(directory,'observations'),{scopePeak:{kind:'live'}})), NTS_GATE_RUN_DIR: directory, NTS_GATE_CASE_COSTS_DIR: costs, NTS_GATE_STEP: "peak-control" } });
  assert.equal(result.status, 0, result.stderr);
  const { peak, group } = JSON.parse(result.stdout);
  const files = readdirSync(costs); assert.equal(files.length, 1);
  const observation = JSON.parse(readFileSync(join(costs, files[0]), "utf8"));
  assert.equal(observation.peak_bytes, peak);
  assert.ok(peak >= 24 * 2 ** 20 && peak <= 128 * 2 ** 20);
  assert.equal(observation.scope_budget_bytes, 128 * 2 ** 20);
  assert.equal(observation.step, "peak-control");
  assert.equal(existsSync(join(CGROUP, group)), false);
});

// The peak observer may retire before close; instrumentation errors still
// report by name, but neither path may skip the physical slice's stop job.
for(const failure of ['departed','EIO','EACCES'])
test(`aggregate peak ${failure} still drains its run slice`,async t=>{
  const directory=scratch();t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const costs=join(directory,'costs');mkdirSync(costs);
  const code=`import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {MemoryRun} from ${JSON.stringify(new URL('./worker-memory.ts',import.meta.url).href)};
import {hostObservations,HostObservationError,CgroupDeparted} from ${JSON.stringify(new URL('../gate/host-observations.ts',import.meta.url).href)};
import {spawnTest} from ${JSON.stringify(new URL('../gate/test-wait.ts',import.meta.url).href)};
const failure=${JSON.stringify(failure)},observations=hostObservations();
const host=failure==='departed'?observations:{...observations,cgroupMemoryPeak:()=>{throw new HostObservationError('host observation memory.peak failed: '+failure,{cause:Object.assign(Error(failure),{code:failure})});}};
const run=new MemoryRun({budgetBytes:128*2**20,host}),ref=observations.acquireCgroup(run.group);
if(failure==='departed'){
 const stopped=spawnTest('systemctl',['--user','stop',run.slice],{encoding:'utf8'});assert.equal(stopped.status,0,stopped.stderr);
 run.close();await run.closed;
}else{
 assert.throws(()=>run.close(),error=>error.cause instanceof HostObservationError&&error.cause.message.includes(failure));
 await assert.rejects(run.closed,error=>error.cause instanceof HostObservationError&&error.cause.message.includes(failure));
}
assert.equal(existsSync(run.directory),false);
assert.throws(()=>observations.cgroupCharge(ref.path,ref.inode),CgroupDeparted);
console.log(JSON.stringify({drained:true}));`;
  const env={...fixtureEnvironment(t,writeOwnMemory(join(directory,'observations'),{resident:{kind:'live'},scopePeak:{kind:'live'}})),NTS_GATE_RUN_DIR:directory,NTS_GATE_CASE_COSTS_DIR:costs,NTS_GATE_STEP:'peak-cleanup'};
  const result=spawnTest(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env});
  assert.equal(result.status,0,result.stderr??'');assert.deepEqual(JSON.parse(result.stdout??''),{drained:true});
  const rows=readdirSync(costs);
  if(failure==='departed'){
    assert.equal(rows.length,1);const file=rows[0];assert.ok(file);
    assert.equal(JSON.parse(readFileSync(join(costs,file),'utf8')).peak_bytes,null);
  }else assert.equal(rows.length,0);
});

test("compiler reserves 32 GiB under a resident cap while executed programs retain RLIMIT_AS", async (t) => {
  t.after(() => memoryRun().close());
  const code = "import mmap,resource; held=mmap.mmap(-1,32*1024**3,flags=mmap.MAP_PRIVATE|mmap.MAP_ANONYMOUS,prot=mmap.PROT_READ|mmap.PROT_WRITE); print(resource.getrlimit(resource.RLIMIT_AS)[0])";
  const tools = { memoryCapKb: 64 * 1024 };
  const before = spawnTest("sh", capped(tools, "python3", ["-c", code]), { encoding: "utf8" });
  assert.notEqual(before.status, 0, "the old compiler address cap rejects its virtual reservation");
  const compiled = testProcessResult(compileSync(tools, "python3", ["-c", code], { encoding: "utf8", timeout: TEST_HANG_MS }), "the resident compiler control");
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.equal(compiled.stdout.trim(), "-1", "compiler inherits no RLIMIT_AS");
  assert.equal(compiled.memoryKilled, false);
  const active = await compileActive(tools, "python3", ["-c", code]);
  assert.equal(active.status, compiled.status, active.stderr);
  assert.equal(active.stdout, compiled.stdout);assert.equal(active.memoryKilled, false);
  assert.equal(active.residentLimitBytes, compiled.residentLimitBytes);
  assert.equal(active.residentRunBytes, compiled.residentRunBytes);
  const executed = spawnTest("sh", capped(tools, "python3", ["-c", "import resource; print(resource.getrlimit(resource.RLIMIT_AS)[0])"]), { encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout.trim(), String(64 * 2 ** 20));
});

test("resident async compiles retain explicit CPU and inactivity supervision", t => {
  const directory = scratch(); t.after(() => rmSync(directory, {recursive: true, force: true}));
  const activeModule = new URL("../gate/active-process.ts", import.meta.url).href;
  const memoryModule = new URL("./worker-memory.ts", import.meta.url).href;
  const code = `import assert from 'node:assert/strict';import {mock} from 'node:test';
import {scriptedCommand,commandSample,commandObservationFixture} from ${JSON.stringify(new URL('../gate/command-observations-fixture.ts',import.meta.url).href)};
const real=await import(${JSON.stringify(activeModule)});let expected;let calls=0;
mock.module(${JSON.stringify(activeModule)},{namedExports:{...real,activeCommand:(command,args,options)=>{
 calls++;
 for(const key of ['idleMs','pollMs','cpuBudgetSeconds','onActivity','observations'])assert.equal(options[key],expected[key],key+' was dropped');
 return Promise.resolve(scriptedCommand(command,options,[commandSample(500,{cpu:calls===1?10:0,busy:calls===1})]));
}}});
const {compileActive,inResidentWorker,serialRun}=await import(${JSON.stringify(memoryModule)});
const tools={memoryCapKb:256*1024};
// Enter the bounded scope before testing a case's short activity limits.
await serialRun(tools);
assert.ok(inResidentWorker());
const env={...${testEnvironmentHandoff(["NTS_TOOLING_SLICE","NTS_GATE_SCOPE_EXPECTED","NTS_MEMORY_RESERVATION"])},NTS_GATE_STEP:'resident-bridge',NTS_GATE_STEP_ATTEMPT:'control',NTS_GATE_STEP_RESULT:${JSON.stringify(join(directory, "instrument.json"))}};
expected={idleMs:real.COMMAND_IDLE_GUARD_MS,pollMs:50,cpuBudgetSeconds:0.1,onActivity(){},observations:commandObservationFixture().observations};
await assert.rejects(compileActive(tools,'/supplied-compiler',['runaway'],{env,...expected}),e=>e instanceof real.CommandNotMeasuredError&&e.kind==='runaway');
expected={idleMs:500,pollMs:50,cpuBudgetSeconds:10,onActivity(){},observations:commandObservationFixture().observations};
await assert.rejects(compileActive(tools,'/supplied-compiler',['hung'],{env,...expected}),e=>e instanceof real.CommandNotMeasuredError&&e.kind==='hung');
assert.equal(calls,2,'both compiles reached the injected activity observer');
console.log('resident bounds retained');`;
  const result = spawnTest(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", code], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /resident bounds retained/);
});

test("a compiler OOM loses only its in-flight case and restarts that worker", { timeout: TEST_HANG_MS }, async (t) => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "worker-oom-control" });
  const gate = await gatePool(1);
  t.after(gate.close);
  const rows: any[] = [];
  await runMemoryWorkers({
    paths: ["before", "oom", "after"], jobs: 1, memory, workerBytes: 96 * 2 ** 20,
    token: gate.token,
    args: () => [fixture, directory], onRow: (row) => rows.push(row),
  });
  assert.deepEqual(rows.map((row) => [row.path, row.bucket]), [["before", "strict-pass"], ["oom", "memory-cap"], ["after", "strict-pass"]]);
  assert.notEqual(rows[0].pid, rows[2].pid, "next case uses a fresh process");
  assert.equal(existsSync(join(CGROUP, memory.group)), false, "run cgroup is removed");
  await gate.settled();
  assert.equal(gate.seen.grant, 3, "each case, the lost one included, held one token");
});

test("aggregate OOM retains a survivor verdict and per-worker counters outlive scopes", { timeout: TEST_HANG_MS }, async (t) => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of ["pressure-a", "pressure-b", "closed-reader-control"]) {
    const fifo = spawnTest("mkfifo", [join(directory, `release-${path}`)], { encoding: "utf8" });
    assert.equal(fifo.status, 0, fifo.stderr);
  }
  const memory = new MemoryRun({ budgetBytes: 768 * 2 ** 20, id: "aggregate-oom-control" });
  const gate = await gatePool(2);
  t.after(gate.close);
  const rows: any[] = [];
  const reports: string[] = [];
  let closedReaderControl = false;
  const releaseReader = (path: string | number): string => {
    try { writeFileSync(path, "x", { flag: constants.O_WRONLY | constants.O_NONBLOCK }); return "released"; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // The OOM-killed reader can disappear before open, or before write.
      if (code !== "ENXIO" && code !== "EPIPE") throw error;
      return code;
    }
  };
  const summary = await runMemoryWorkers({
    paths: ["pressure-a", "pressure-b"], jobs: 2, memory, workerBytes: 640 * 2 ** 20,
    token: gate.token,
    args: (index) => [fixture, directory, String(index)],
    onRow: (row) => rows.push(row),
    report: message => {
      reports.push(message);
      if (message.startsWith("resident pressure: requeued ")) {
        if (!closedReaderControl) {
          const path = join(directory, "release-closed-reader-control");
          const reader = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
          const writer = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
          closeSync(reader); // Structural EPIPE: the writer is already open.
          try { assert.equal(releaseReader(writer), "EPIPE"); closedReaderControl = true; }
          finally { closeSync(writer); }
        }
        for (const path of ["pressure-a", "pressure-b"]) releaseReader(join(directory, `release-${path}`));
      }
    },
  });
  assert.deepEqual(rows.map(row => [row.path, row.bucket]).sort(), [["pressure-a", "strict-pass"], ["pressure-b", "strict-pass"]]);
  assert.equal(rows.length, 2, "each input has exactly one final verdict");
  assert.equal(closedReaderControl, true, "the vanished reader did not lose the survivor verdict");
  assert.ok(summary.pressureRequeues >= 1 && summary.pressureRequeues <= 2, JSON.stringify(summary));
  assert.equal(summary.isolatedReplays, summary.pressureRequeues);
  assert.ok(summary.aggregatePressureKills > 0, JSON.stringify(summary));
  assert.equal(rows.reduce((n, row) => n + row.residentPressureRetries, 0), summary.pressureRequeues);
  for (const row of rows) assert.equal(row.held, 400 * 2 ** 20, "replay does the same allocation");
  assert.ok(reports.some(message => message.startsWith("resident pressure requeues:")), reports.join("\n"));
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
  // A requeued case returned its parallel token; its isolated replay took
  // one fresh token, and nothing below the worker asked for another.
  await gate.settled();
  assert.equal(gate.seen.grant, 2 + summary.isolatedReplays, JSON.stringify({ seen: gate.seen, summary }));
  assert.equal(gate.seen.cancel, 0);
});

// Counter origins, not the location of an OOM victim, decide whether a cap
// is a case verdict. No test invokes the machine-wide OOM killer.
test("only a worker-subtree OOM establishes a memory-cap verdict", () => {
  const before = { oom: 3, kills: 5 };
  assert.equal(memoryCause(before, { oom: 3, kills: 6 }, 7, 8), "aggregate-pressure");
  assert.equal(memoryCause(before, { oom: 3, kills: 6 }, 7, 7), "system-pressure");
  assert.equal(memoryCause(before, { oom: 4, kills: 6 }, 7, 8), "own-limit");
  assert.equal(memoryCause(before, { oom: 4, kills: 5 }, 7, 7), "own-limit");
  assert.equal(memoryCause(before, before, 7, 8), undefined, "pressure without a kill loses no case");
  assert.throws(() => memoryCause(before, { oom: 2, kills: 5 }, 7, 7), /counters went backwards/);
});

// The idle-pressure handshake's hang guards, both inside node's test timeout:
// its stages share IDLE_PRESSURE_HANG_MS, and releasing every party and the
// pool's settling share what remains of the case's bound, which leaves a
// margin for cleanup. A stage that never arrives fails by its name first.
const IDLE_PRESSURE_HANG_MS = TEST_HANG_MS / 2;
const IDLE_PRESSURE_CASE_MS = TEST_HANG_MS - 30_000;
// The own-limit control's pool settles in about a second; this bounds a pool
// that never stops its worker, well inside the test's own timeout.
const OWN_LIMIT_SETTLE_MS = 20_000;

/**
 * The idle-pressure case and the one owner of every wait in it. The idle
 * holder's completed row lets the test take the released token as its hold,
 * so its worker stays idle with 200 MiB retained; the hold's grant
 * ('idle-reported') starts the trigger's allocation, which only fits once the
 * aggregate kills the idle worker; the pool's idle-worker pressure report
 * returns the hold and releases the trigger. The owner awaits each stage by
 * name within their shared hang guard (`reportHangMs` bounds the report alone,
 * for the control). On expiry it
 * releases every party (both FIFOs, the hold, the memory run), waits for the
 * pool to settle and fails naming the stage. Its cleanup returns the hold
 * before the token pool closes, whose close waits for every held token.
 * `withholdReport` keeps the pool's report from the handshake: the control
 * that a missing report fails by name.
 */
async function idlePressureCase(t: { after: (fn: () => unknown) => void }, { reportHangMs, withholdReport = false }: { reportHangMs?: number; withholdReport?: boolean } = {}) {
  const caseGuard = hangDeadline(IDLE_PRESSURE_CASE_MS), stages = hangDeadline(IDLE_PRESSURE_HANG_MS);
  const gate = await gatePool(2);
  const directory = scratch();
  const cleanup: { returnHold?: () => Promise<void> } = {};
  t.after(async () => {
    try { await cleanup.returnHold?.(); } finally {
      await gate.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const memory = new MemoryRun({ budgetBytes: 768 * 2 ** 20, id: "idle-pressure-control" });
  return { memory, gate, outcome: idlePressureRun(directory, memory, gate, cleanup, { caseGuard, stages, reportHangMs }, withholdReport) };
}

type IdlePressureGuards = { caseGuard: HangDeadline; stages: HangDeadline; reportHangMs: number | undefined };
async function idlePressureRun(directory: string, memory: MemoryRun, gate: Awaited<ReturnType<typeof gatePool>>, cleanup: { returnHold?: () => Promise<void> }, { caseGuard, stages, reportHangMs }: IdlePressureGuards, withholdReport: boolean) {
  const holdStop = new AbortController();
  let hold: Promise<(() => void) | null> | undefined, returning: Promise<void> | undefined;
  let holdGranted = false, holdClosed = false, idleReported = false;
  const returnHold = () => returning ??= (async () => {
    holdStop.abort();
    const release = await hold;
    if (release) await releaseToken(release);
    holdClosed = true;
  })();
  cleanup.returnHold = returnHold;
  const releaseFifo = (name: string) => {
    // A party already gone (the trigger may be collateral damage) has no reader.
    let fifo: number;
    try { fifo = openSync(join(directory, `release-${name}`), constants.O_WRONLY | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENXIO") return; throw error; }
    try { writeSync(fifo, "x"); } finally { closeSync(fifo); }
  };
  for (const name of ["idle", "trigger"]) {
    const result = spawnTest("mkfifo", [join(directory, `release-${name}`)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const rows: any[] = [];
  const reports: string[] = [];
  let settled: { summary: Awaited<ReturnType<typeof runMemoryWorkers>> } | { error: unknown } | undefined;
  const run = runMemoryWorkers({
    paths: ["idle-holder", "idle-trigger", "after"], jobs: 2, memory, workerBytes: 768 * 2 ** 20,
    args: index => [fixture, directory, String(index)],
    token: async (path, signal) => { if (path === "after") await hold; return gate.token(path, signal); },
    onRow: row => {
      rows.push(row);
      if (row.path === "idle-holder" && hold === undefined) {
        // Hold the released token explicitly. A priority waiter would now
        // close this idle worker, removing the intended aggregate victim.
        hold = gate.token("fixture idle hold", holdStop.signal).then(release => {
          if (!release) return null;
          writeFileSync(join(directory, "idle-reported"), "idle");
          holdGranted = true;
          return release;
        });
      }
    },
    report: message => {
      reports.push(message);
      if (!withholdReport && message.startsWith("resident pressure: idle worker ")) {
        idleReported = true;
        void returnHold();
        releaseFifo("trigger");
      }
    },
  }).then(summary => { settled = { summary }; }, error => { settled = { error }; });
  const outcome = () => settled === undefined ? undefined : "error" in settled ? `the pool failed: ${(settled.error as Error)?.stack ?? settled.error}` : "the pool finished without it";
  try {
    await waitFor("the idle holder's completed row and the test's hold token", () => holdGranted, { deadline: stages, stopped: outcome });
    await waitFor("the resident pool's idle-worker pressure report", () => idleReported, reportHangMs === undefined ? { deadline: stages, stopped: outcome } : { timeoutMs: Math.min(reportHangMs, stages.remaining()), stopped: outcome });
  } catch (missing) {
    // Release every party, so none of them outlives this named failure.
    releaseFifo("idle");
    releaseFifo("trigger");
    await returnHold();
    memory.close();
    // Its own expiry is reported beside the stage's name, never instead of it.
    let unsettled: unknown;
    try { await waitFor("the released resident pool to settle", () => settled !== undefined, { deadline: caseGuard }); }
    catch (error) { unsettled = error; }
    throw new Error(`${(missing as Error).message}\nreports:\n${reports.join("\n")}\npool: ${unsettled === undefined ? outcome() : (unsettled as Error).message}`, { cause: missing });
  }
  await run;
  const done = settled as { summary: Awaited<ReturnType<typeof runMemoryWorkers>> } | { error: unknown };
  if ("error" in done) throw done.error;
  await returnHold();
  return { summary: done.summary, rows, reports, holdClosed };
}

test("aggregate pressure restarts an idle worker without losing or replaying its completed case", { timeout: TEST_HANG_MS }, async t => {
  const { memory, gate, outcome } = await idlePressureCase(t);
  const { summary, rows, reports, holdClosed } = await outcome;
  assert.deepEqual(rows.map(row => [row.path, row.bucket]).sort(), [["after", "strict-pass"], ["idle-holder", "strict-pass"], ["idle-trigger", "strict-pass"]]);
  assert.equal(summary.idlePressureRestarts, 1, reports.join("\n"));
  assert.ok(summary.pressureRequeues <= 1, JSON.stringify(summary));
  assert.equal(summary.isolatedReplays, summary.pressureRequeues);
  assert.equal(rows.find(row => row.path === "idle-holder").residentPressureRetries, 0, "a completed case is never replayed");
  assert.ok(summary.aggregatePressureKills >= 1);
  assert.equal(summary.systemPressureKills, 0);
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
  await gate.settled();
  const accounting=JSON.stringify({seen:gate.seen,summary,history:gate.history});
  assert.ok(summary.returnedOffers===0||summary.returnedOffers===1,accounting);
  assert.equal(gate.seen.grant, 4 + summary.isolatedReplays + summary.returnedOffers,accounting);
  assert.equal(gate.seen.release,gate.seen.grant,accounting);
  assert.equal(holdClosed,true,"the fixture idle hold returned and joined its real token");
});

test("a withheld idle-worker pressure report fails the aggregate-pressure case by its name, holding nothing", { timeout: TEST_HANG_MS }, async t => {
  // The report's stage is bounded short: its expiry, or the pool finishing
  // without the report reaching the handshake, is this control's answer.
  const { memory, gate, outcome } = await idlePressureCase(t, { reportHangMs: 10_000, withholdReport: true });
  await assert.rejects(outcome, /(?:test hung waiting for|test fixture stopped while waiting for) the resident pool's idle-worker pressure report/);
  assert.equal(existsSync(join(CGROUP, memory.group)), false, "every party was released and the pool's cgroups removed");
  await gate.settled();
  assert.equal(gate.seen.release, gate.seen.grant, JSON.stringify(gate.seen));
});

test("a worker death without any OOM evidence is an instrument failure", async t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const rows: any[] = [];
  const memory = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "lost-worker-control" });
  const gate = await gatePool(1);
  t.after(gate.close);
  await assert.rejects(runMemoryWorkers({ paths: ["lost"], jobs: 1, memory, workerBytes: 96 * 2 ** 20,
    token: gate.token,
    args: () => [fixture, directory], onRow: row => rows.push(row) }), /no OOM kill recorded/);
  assert.deepEqual(rows, []);
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
  await gate.settled();
  assert.equal(gate.seen.grant, 1, "the lost case's token came back with its worker");
});

test("a worker lost while it waits for a token cancels the wait, and the failed pool holds nothing", { timeout: TEST_HANG_MS }, async t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "token-wait-loss-control" });
  const gate = await gatePool(1);
  t.after(gate.close);
  // Lazy startup needs a token. Warm the first worker before the second
  // takes the only token; the first then waits with its next case reserved.
  const completed:string[]=[];
  const run = runMemoryWorkers({ paths: ["gate-a", "hold-b", "hold-c"], jobs: 2, memory, workerBytes: 96 * 2 ** 20,
    token: gate.token,
    args: index => [fixture, directory, String(index)], onRow: row => {completed.push(row.path);} });
  await waitFor('first worker warm with its initial case',()=>existsSync(join(directory,'ready-gate-a')));
  writeFileSync(join(directory,'go-gate-a'),'go');
  const busy = () => readdirSync(directory).filter(name => name.startsWith("busy-"));
  await waitFor("one worker holding the token and one waiting for it", () => busy().length === 1 && gate.waiting() === 1);
  const waiter = busy()[0] === "busy-0" ? 1 : 0;
  writeFileSync(join(directory, `exit-${waiter}`), "x");
  await assert.rejects(run, new RegExp(`worker ${waiter} exited 19 without an in-flight case; no OOM kill recorded`));
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
  await gate.settled();
  assert.deepEqual(completed,['gate-a']);
  assert.deepEqual({ request: gate.seen.request, grant: gate.seen.grant, release:gate.seen.release,cancel: gate.seen.cancel }, { request: 3, grant: 2,release:2,cancel: 1 });
});

test("no worker asks for a token once every case is taken", { timeout: TEST_HANG_MS }, async t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "no-remaining-token-control" });
  const gate = await gatePool(2);
  t.after(gate.close);
  const rows: any[] = [];
  await runMemoryWorkers({ paths: ["one", "two", "three"], jobs: 2, memory, workerBytes: 96 * 2 ** 20,
    token: gate.token,
    args: index => [fixture, directory, String(index)], onRow: row => rows.push(row) });
  assert.deepEqual(rows.map(row => row.path).sort(), ["one", "three", "two"]);
  await gate.settled();
  assert.deepEqual({ request: gate.seen.request, grant: gate.seen.grant, cancel: gate.seen.cancel }, { request: 3, grant: 3, cancel: 0 });
});

/** A real run whose workers' `method` throws on its `call`th use. */
function failingWorkerCall(memory: MemoryRun, method: "counters" | "stop", call: number, message: string): MemoryRun {
  const forward = (target: object, key: string | symbol) => {
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  };
  return new Proxy(memory, {
    get(run, key) {
      if (key !== "worker") return forward(run, key);
      return (index: string | number, bytes: number) => {
        const worker = run.worker(index, bytes);
        let uses = 0;
        return new Proxy(worker, {
          get(inner, name) {
            if (name !== method) return forward(inner, name);
            return (...args: unknown[]) => {
              if (++uses === call) throw new Error(message);
              return Reflect.apply(Reflect.get(inner, method) as (...args: unknown[]) => unknown, inner, args);
            };
          },
        });
      };
    },
  });
}

// A fault after a case's token is granted must still return it, and the pool
// still reports the fault itself: once at dispatch (the second counter read),
// once in the close of a worker lost with its case in flight (its first stop).
for (const [control, method, call, path, message] of [
  ["dispatch-failure-control", "counters", 2, "one", "control: the counter read at dispatch failed"],
  ["close-failure-control", "stop", 1, "lost", "control: stopping the lost worker's scope failed"],
] as const) {
  test(`a fault after a token is granted returns it: ${control}`, { timeout: TEST_HANG_MS }, async t => {
    const directory = scratch();
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const memory = failingWorkerCall(new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: control }), method, call, message);
    const gate = await gatePool(1);
    t.after(gate.close);
    await assert.rejects(runMemoryWorkers({ paths: [path], jobs: 1, memory, workerBytes: 96 * 2 ** 20,
      token: gate.token,
      args: index => [fixture, directory, String(index)], onRow: () => {} }), new RegExp(message));
    assert.equal(existsSync(join(CGROUP, memory.group)), false);
    await gate.settled();
    assert.deepEqual({ request: gate.seen.request, grant: gate.seen.grant, release: gate.seen.release, cancel: gate.seen.cancel },
      { request: 1, grant: 1, release: 1, cancel: 0 });
  });
}

test("compileSync reads the explicit aggregate across intermediate worker ancestors", () => {
  const module = new URL("./worker-memory.ts", import.meta.url).href;
  const code = `import fs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const aggregate='/test-run.slice', worker=aggregate+'/intermediate.slice/worker.slice';
process.env.NTS_CENSUS_RUN_GROUP=aggregate;
process.env.NTS_CENSUS_WORKER_GROUP=worker;
process.env.NTS_CENSUS_WORKER_MAX_BYTES='1024';
let killed=false; const reads=[]; const original=fs.readFileSync;
fs.readFileSync=(path,...args)=>{
 const name=String(path);
 if(name==='/proc/self/cgroup')return '0::'+worker+'/command.scope';
 if(name.startsWith('/sys/fs/cgroup/')){
  reads.push(name);
  if(name.endsWith('/memory.max'))return '1024';
  if(name.endsWith('/memory.swap.max'))return '0';
  if(name==='/sys/fs/cgroup'+worker+'/memory.events')return 'oom 0\\noom_kill '+Number(killed)+'\\n';
  if(name==='/sys/fs/cgroup'+aggregate+'/memory.events.local')return 'oom '+Number(killed)+'\\noom_kill 0\\n';
  throw new Error('unexpected group read '+name);
 }
 return original(path,...args);
};
cp.spawnSync=()=>{killed=true;return {status:137,stdout:'',stderr:''};};
syncBuiltinESMExports();
const {compileSync}=await import(${JSON.stringify(module)});
let error;
try{compileSync({},'unused',[],{encoding:'utf8'});}catch(caught){error=String(caught);}
console.log(JSON.stringify({error,reads}));`;
  const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.match(actual.error, /aggregate-pressure: unused was killed without exceeding its own case budget/);
  assert.equal(actual.reads.filter(path => path === "/sys/fs/cgroup/test-run.slice/memory.events.local").length, 2);
  assert.ok(!actual.reads.some(path => path.endsWith("intermediate.slice/memory.events.local")));
});

test("an unavailable user bus refuses to compile instead of running uncapped", () => {
  const module = new URL("./worker-memory.ts", import.meta.url).href;
  const code = `import {compileSync} from ${JSON.stringify(module)}; compileSync({memoryCapKb:65536},"sh",["-c","echo UNCAPPED"],{encoding:"utf8"});`;
  const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...testEnvironment(), DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-nts-user-bus" },});
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes("UNCAPPED"));
  assert.match(result.stderr, /resident cap: user manager StartTransientUnit \S+ failed: [^]*\(exit status \d+\)/);
});

test("a serial runner shares one scope across compiles and removes every cgroup", () => {
  const result = spawnTest(process.execPath, [join(HERE, "fixtures/resident-serial.ts")], { encoding: "utf8",});
  assert.equal(result.status, 0, result.stderr);
  const { groups, own, boundary } = JSON.parse(result.stdout);
  assert.deepEqual(groups, [own, own]);
  assert.equal(existsSync(join(CGROUP, boundary)), false);
  assert.equal(existsSync(join(CGROUP, dirname(boundary))), false);
});

test("compiles at once in one process each run on a lane of their own, under the run's budget, and a later one takes an idle lane", () => {
  const directory = scratch(), fifo = join(directory, "both-running");
  try {
    assert.equal(spawnTest("mkfifo", [fifo], { encoding: "utf8" }).status, 0);
    // In a process of its own, so the run it makes is its alone. The first
    // compile reads the fifo the second writes: neither ends until both run.
    const code = `import {compileActive, memoryRun} from ${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)};
const tools = {memoryCapKb: 64 * 1024}, cgroup = "cat /proc/self/cgroup", lane = result => result.stdout.split("\\n")[0].split("/").at(-2);
const run = memoryRun(2 * 64 * 2 ** 20);
const both = await Promise.all([compileActive(tools, "sh", ["-c", cgroup + "; cat " + ${JSON.stringify(fifo)}]),
  compileActive(tools, "sh", ["-c", cgroup + "; echo both > " + ${JSON.stringify(fifo)}])]);
const later = await compileActive(tools, "sh", ["-c", cgroup]);
let refused = "";
try { memoryRun(3 * 64 * 2 ** 20); } catch (error) { refused = String(error); }
console.log(JSON.stringify({lanes: [...both, later].map(lane), limits: [...both, later].map(result => result.residentLimitBytes), read: both[0].stdout.trim().split("\\n").pop(), budget: run.budgetBytes, refused}));
run.close();`;
    const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const { lanes, limits, read, budget, refused } = JSON.parse(result.stdout);
    assert.equal(read, "both", "the two compiles ran at once");
    assert.ok(lanes[0] && lanes[1] && lanes[0] !== lanes[1], `two compiles at once never share a lane: ${lanes.join(", ")}`);
    assert.ok(lanes.slice(0, 2).includes(lanes[2]), `a later compile takes an idle lane: ${lanes.join(", ")}`);
    assert.deepEqual(limits, [64 * 2 ** 20, 64 * 2 ** 20, 64 * 2 ** 20], "each at its own cap");
    assert.equal(budget, 2 * 64 * 2 ** 20, "the run's aggregate is the budget its first caller asked");
    assert.match(refused, /this process's run holds \d+ bytes, not the \d+ asked for/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("byte budgets accept kernel page rounding while never exceeding the reservation", () => {
  const budget = 193 * 2 ** 20 + 13;
  const memory = new MemoryRun({ budgetBytes: budget, id: "page-rounding-control" });
  try {
    const worker = memory.worker("round", 96 * 2 ** 20 + 17);
    for (const [group, reserved] of [[memory.group, budget], [worker.group, worker.bytes]] as const) {
      const limit = Number(readFileSync(join(CGROUP, group, "memory.max"), "utf8"));
      assert.ok(limit > 0 && limit <= reserved);
      assert.equal(readFileSync(join(CGROUP, group, "memory.swap.max"), "utf8").trim(), "0");
    }
  } finally {
    memory.close();
  }
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
});

test("a closed worker cannot recreate an uncapped parent slice", () => {
  const memory = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "closed-worker-control" });
  const worker = memory.worker("closed", 96 * 2 ** 20);
  memory.close();
  assert.throws(() => worker.scope(process.execPath, []), /worker is closed/);
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
});

// A queued job and a lagging ControlGroup property, without changing the real
// manager. Patches live only in a short-lived child, never in peer processes.
async function fakeManager(mode, module) {
  const { default: fs } = await import("node:fs");
  const { default: cp } = await import("node:child_process");
  const { syncBuiltinESMExports } = await import("node:module");
  const original = { spawn: cp.spawnSync, read: fs.readFileSync, exists: fs.existsSync };
  const units = new Map();
  const calls = [];
  let root, rootLookups = 0, wall = 0, clockReads = 0;
  const clock = Date.now;
  const remove = unit => {
    const held = units.get(unit);
    for (const [name, row] of units) if (name === unit || held && row.group.startsWith(held.group + "/")) units.delete(name);
  };
  const response = (stdout = "", status: number | null = 0, stderr = "", signal: string | null = null) => ({ stdout, stderr, status, signal });
  const attempts = new Map<string, number>();
  const attempt = (key: string) => { const n = (attempts.get(key) ?? 0) + 1; attempts.set(key, n); return n; };
  cp.spawnSync = ((command: string, args: readonly string[] = [], options?: import("node:child_process").SpawnSyncOptions) => {
    if (command === "busctl") {
      let at = args.indexOf("StartTransientUnit");
      if (at >= 0) {
        const unit = args[at + 2]; root ??= unit;
        if (unit !== root) {
          calls.push(`create-attempt:${unit}`);
          const n = attempt(`create:${unit}`);
          if (mode === "bus-busctl-timeout") return response("", 1, "Call failed: Connection timed out");
          if (mode === "bus-signal") return response("", null, "", "SIGKILL");
          if (mode === "empty-stderr") return response("", 1, "");
          if (mode === "bus-lost-reply" && n === 2) return response("", 1, `Call failed: Unit ${unit} already exists.`);
        }
        const group = `/fake-user/${root}${unit === root ? "" : `/${unit}`}`;
        units.set(unit, { unit, group, bytes: Number(args[args.indexOf("MemoryMax") + 2]), ready: false, reads: 0 });
        calls.push(`create:${unit}`);
        if (mode === "bus-lost-reply" && unit !== root) return response("", 1, "Call failed: Connection timed out");
        return response('o "/fake-job"');
      }
      at = args.indexOf("StopUnit");
      if (at >= 0) {
        const unit = args[at + 2];
        calls.push(`stop:${unit}`);
        if (["failed-cleanup", "realization-cleanup"].includes(mode) && unit !== root) return response("", 1, "injected cleanup failure");
        if (mode === "refusal-bus-cleanup" && unit !== root) return response("", 1, "Call failed: Transport endpoint is not connected");
        if (!["queued-stop", "retained-stop"].includes(mode)) remove(unit);
        return response('o "/fake-stop-job"');
      }
    }
    if (command === "systemctl") {
      const operation = args[1], unit = args[2], row = units.get(unit);
      calls.push(`${operation}:${unit}`);
      if (operation === "stop") {
        calls.push(`stop-job-finished:${unit}`);
        if (mode !== "retained-stop") remove(unit);
        return response();
      }
      if (operation === "start") {
        if (mode === "failed-cleanup" && unit !== root) return response("", 1, "injected start failure: invalid unit configuration (job result: dependency)");
        if (["invalid-start", "refusal-bus-cleanup"].includes(mode) && unit !== root) return response("", 1, `Job for ${unit} failed: invalid unit configuration (job result: dependency).`);
        if (unit !== root && (mode === "bus-start" || mode === "bus-transient" && attempt(`start:${unit}`) === 1))
          return response("", 1, `Failed to start ${unit}: Transport endpoint is not connected\nSee user logs and 'systemctl --user status ${unit}' for details.`);
        if (mode === "queued-start" && unit !== root) {
          calls.push(`start-job-queued:${unit}`);
          // Supplied time passes the former 3 s deadline while the job is
          // queued. Only the job's completion publishes its realized group.
          wall += 4000;
        }
        row.ready = true;
        calls.push(`start-job-finished:${unit}`);
        return response();
      }
      if (operation === "show") {
        if (!args.includes("--property=ControlGroup")) return response("LoadState=loaded\nActiveState=active\nSubState=active\nJob=0\n");
        if (!row.ready) throw new Error("ControlGroup read before joining start job");
        calls.push(`group-read:${unit}`);
        row.reads++;
        if (["always-empty", "journal-failed", "journal-empty", "journal-throws", "realization-cleanup"].includes(mode) && unit !== root) return response();
        if (unit !== root) {
          if (mode === "wrong-parent") return response(`/someone-else/${unit}`);
          if (mode === "parent-traversal") return response(`/fake-user/${root}/../${unit}`);
          if (mode === "wrong-unit") return response(row.group + ".other");
        }
        return response(row.group);
      }
    }
    if (command === "journalctl") {
      calls.push(`journal:${JSON.stringify(args)}`);
      if (mode === "journal-failed") return response("", 1, "injected journal failure");
      if (mode === "journal-empty") return response();
      if (mode === "journal-throws") throw new Error("injected journal spawn error");
      return response(`${args[args.indexOf("--unit") + 1]}: Failed to create cgroup: Cannot allocate memory`);
    }
    return original.spawn(command, args, options);
  }) as typeof cp.spawnSync;
  fs.existsSync = path => {
    const text = String(path);
    if (text === "/sys/fs/cgroup" || text === "/sys/fs/cgroup/") { rootLookups++; throw new Error("cgroup root was checked"); }
    if (text.startsWith("/sys/fs/cgroup/")) return [...units.values()].some(row => text === "/sys/fs/cgroup" + row.group);
    return original.exists(path);
  };
  fs.readFileSync = (path, ...args) => {
    const text = String(path);
    if (text.startsWith("/sys/fs/cgroup/")) {
      if (text.endsWith("/cgroup.events")) {
        if (![...units.values()].some(row => text === "/sys/fs/cgroup" + row.group + "/cgroup.events"))
          throw Object.assign(new Error("removed cgroup"), {code: "ENOENT"});
        calls.push("kernel-populated-after-stop-job");
        return "populated 0\n";
      }
      const row = [...units.values()].find(row => text === "/sys/fs/cgroup" + row.group + "/memory.max" || text === "/sys/fs/cgroup" + row.group + "/memory.swap.max");
      if (!row) throw new Error(`unexpected kernel read ${text}`);
      return text.endsWith("memory.max") ? String(row.bytes) : "0";
    }
    return original.read(path, ...args);
  };
  syncBuiltinESMExports();
  const { MemoryRun } = await import(module);
  const { publishPressure, publishToolingFailure, ToolingInstrumentError, instrumentPolicy } = await import(new URL("../gate/step-result.ts", module).href);
  const run = new MemoryRun({ budgetBytes: 128 * 2 ** 20, id: "fake-manager" });
  const instrumentPath = run.directory + "/slice-start.json";
  let error = null, closeError = null, group = null, instrument = null;
  let errorName: string | null = null, causeName: string | null = null, hostState = false, causeMessages: string[] = [];
  const { HostStateError } = await import(new URL("../gate/host-state.ts", module).href);
  if (mode === "queued-start") Date.now = () => { clockReads++; return wall; };
  try { group = run.worker(0, 64 * 2 ** 20).group; }
  catch (caught) {
    error = String(caught);
    errorName = caught instanceof Error ? caught.name : typeof caught;
    hostState = caught instanceof HostStateError;
    if (caught instanceof Error && caught.cause instanceof Error) causeName = caught.cause.name;
    if (caught instanceof Error && caught.cause instanceof AggregateError) causeMessages = caught.cause.errors.map(String);
    const receipt = { NTS_GATE_STEP_RESULT: instrumentPath, NTS_GATE_STEP: "tooling", NTS_GATE_STEP_ATTEMPT: "slice-start" };
    if (caught instanceof ToolingInstrumentError) publishToolingFailure(caught, receipt);
    else publishPressure(caught, receipt);
    if (original.exists(instrumentPath)) instrument = JSON.parse(original.read(instrumentPath, "utf8"));
  }
  finally {
    Date.now = clock;
    // Move a wall clock across the old readiness deadline without sleeping.
    // Job completion, not this clock, must decide whether cleanup is done.
    if (["queued-stop", "retained-stop"].includes(mode)) { let tick = 0; Date.now = () => tick += 4000; }
    try { run.close(); } catch (caught) { closeError = String(caught); }
  }
  process.stdout.write(JSON.stringify({ error, errorName, causeName, hostState, causeMessages, closeError, group, calls, rootLookups, clockReads, wall, instrument,
    policy: instrument ? instrumentPolicy(instrument.kind) : null, remaining: units.size }));
}

for (const mode of ["queued-start", "always-empty", "journal-failed", "journal-empty", "journal-throws", "wrong-parent", "parent-traversal", "wrong-unit", "invalid-start", "failed-cleanup", "realization-cleanup", "queued-stop", "retained-stop",
  "bus-start", "bus-busctl-timeout", "bus-signal", "bus-transient", "bus-lost-reply", "empty-stderr", "refusal-bus-cleanup"]) {
  test(`slice setup with fake manager: ${mode}`, () => {
    const code = `(${fakeManager.toString()})(${JSON.stringify(mode)},${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)});`;
    const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8",});
    assert.equal(result.status, 0, result.stderr);
    const actual = JSON.parse(result.stdout);
    assert.equal(actual.rootLookups, 0);
    if (mode === "retained-stop") {
      assert.match(actual.closeError, /cgroup was not removed after its stop job finished \(populated 0\)/);
      assert.ok(actual.remaining > 0);
      assert.ok(actual.calls.includes("kernel-populated-after-stop-job"));
    } else assert.equal(actual.remaining, 0);
    const count = (prefix: string) => actual.calls.filter((call: string) => call.startsWith(prefix) && call.endsWith("-w0.slice")).length;
    if (["bus-start", "bus-busctl-timeout", "bus-signal"].includes(mode)) {
      // Unreachable twice: one retry, then a named instrument hold.
      if (mode === "bus-signal") {
        // A signal is all the evidence shows: it names the signal, not the bus.
        assert.equal(actual.errorName, "UserManagerSignalError");
        assert.match(actual.error, /user manager call ended by signal SIGKILL \(2 attempts\): busctl --user .*-w0\.slice/);
        assert.doesNotMatch(actual.error, /bus unreachable/);
      } else {
        assert.equal(actual.errorName, "UserBusUnreachableError");
        assert.match(actual.error, /systemd user bus unreachable: (systemctl|busctl) --user .*-w0\.slice.* \(2 attempts\)/);
      }
      assert.ok(actual.hostState, "a machine-state fault carries the host-state marker");
      if (mode === "bus-start") {
        assert.equal(actual.causeName, "UserBusUnreachableError", "the caller's context keeps the original fault as its cause");
        assert.equal(count("start:"), 2);
        assert.match(actual.error, /Failed to start \S+-w0\.slice: Transport endpoint is not connected; then Failed to start/);
        assert.match(actual.error, /diagnostics skipped/);
        assert.ok(!actual.calls.some((call: string) => call.startsWith("journal:")), "an unanswered start reads no diagnostics behind the same bus");
      } else {
        assert.equal(count("create-attempt:"), 2);
        assert.equal(count("start:"), 0);
        assert.match(actual.error, mode === "bus-signal" ? /first attempt: ended by signal SIGKILL/ : /Call failed: Connection timed out; then Call failed: Connection timed out/);
      }
      assert.doesNotMatch(actual.error, /undefined/);
      assert.equal(actual.instrument.kind, "tooling-setup");
      assert.equal(actual.instrument.verdict, "INSTRUMENT", "an unreachable user bus holds the landing instead of failing the code");
      assert.deepEqual(actual.policy, { verdict: "INSTRUMENT", disposition: "operator-hold" });
    } else if (mode === "bus-transient" || mode === "bus-lost-reply") {
      assert.equal(actual.error, null);
      assert.equal(actual.closeError, null);
      assert.ok(actual.group.endsWith("-w0.slice"));
      if (mode === "bus-transient") assert.equal(count("start:"), 2, "one retry after the transient fault");
      else { assert.equal(count("create-attempt:"), 2); assert.equal(count("create:"), 1, "the lost reply's unit is the retry's own"); }
    } else if (mode === "empty-stderr") {
      assert.match(actual.error, /resident cap: user manager StartTransientUnit \S+-w0\.slice failed: no stderr \(exit status 1\)/);
      assert.doesNotMatch(actual.error, /undefined/);
      assert.equal(actual.errorName, "Error", "a nonzero exit with no evidence stays a failure");
      assert.equal(actual.instrument, null);
      assert.equal(count("create-attempt:"), 1, "no retry without bus evidence");
    } else if (mode === "refusal-bus-cleanup") {
      assert.match(actual.error, /start job failed:.*invalid unit configuration/);
      assert.match(actual.error, /cleanup also failed: .*systemd user bus unreachable: busctl --user call .*StopUnit/);
      assert.equal(actual.errorName, "Error", "a refusal keeps its class beside an unreachable cleanup");
      assert.equal(actual.hostState, false);
      assert.equal(actual.instrument, null);
      assert.equal(count("start:"), 1);
      assert.equal(count("stop:"), 2, "the cleanup's one retry");
    } else if (mode === "queued-start" || mode === "queued-stop") {
      assert.equal(actual.error, null);
      assert.equal(actual.closeError, null);
      assert.ok(actual.group.endsWith("-w0.slice"));
      if (mode === "queued-start") {
        assert.equal(actual.wall, 4000, "the job remained queued past the former readiness deadline");
        assert.equal(actual.clockReads, 0, "readiness never consults a wall clock");
        const groups = actual.calls.filter((call: string) => call.startsWith("group-read:"));
        assert.equal(groups.length, 2, "each group is read exactly once");
        for (const call of groups) assert.ok(actual.calls.indexOf("start-job-finished:" + call.slice("group-read:".length)) < actual.calls.indexOf(call));
      }
      if (mode === "queued-stop") assert.equal(actual.calls.filter(call => call.startsWith("stop-job-finished:")).length, 2);
    } else if (mode === "retained-stop") {
      assert.equal(actual.error, null);
    } else if (mode === "failed-cleanup") {
      assert.match(actual.error, /injected start failure/);
      assert.match(actual.error, /invalid unit configuration \(job result: dependency\)/);
      assert.match(actual.error, /injected cleanup failure/);
      assert.equal(actual.errorName, "Error", "cleanup preserves the primary refusal's class");
      assert.equal(actual.instrument, null, "a refusal with failed cleanup stays refused");
      assert.ok(actual.causeMessages.some((message: string) => message.includes("injected cleanup failure")));
    } else if (mode === "invalid-start") {
      assert.match(actual.error, /resident cap: .*?-w0.slice start job failed:.*invalid unit configuration \(job result: dependency\)/);
      assert.equal(actual.instrument, null, "a refused start remains a failure, never a memory-pressure retry");
      assert.equal(count("start:"), 1, "a refusal is never retried");
      assert.equal(actual.calls.filter((call: string) => call.startsWith("group-read:")).length, 1, "a failed worker start never reads its group");
    } else if (["wrong-parent", "parent-traversal", "wrong-unit"].includes(mode)) {
      assert.match(actual.error, /resident cap: .*?-w0.slice has no valid ControlGroup/);
      assert.equal(actual.errorName, "Error");
      assert.equal(actual.instrument, null, "an invalid non-empty group is a failure, never an instrument hold");
      assert.equal(actual.policy, null);
      assert.doesNotMatch(actual.error, /realization failed/);
      if (mode === "wrong-parent") assert.match(actual.error, /\/someone-else\//);
      else if (mode === "parent-traversal") assert.match(actual.error, /\/\.\.\//);
      else assert.match(actual.error, /-w0\.slice\.other/);
    } else {
      assert.match(actual.error, /resident cap: .*?-w0.slice cgroup realization failed after start job completed successfully \(systemctl exit 0\)/);
      assert.match(actual.error, /ControlGroup is empty/);
      assert.doesNotMatch(actual.error, /cgroup was not removed/);
      assert.equal(actual.instrument.kind, "tooling-setup");
      assert.equal(actual.errorName, "HostStateError");
      assert.ok(actual.hostState, "#880's realization fault is machine state");
      assert.equal(actual.instrument.verdict, "INSTRUMENT", "a failed realization holds the landing instead of failing the code");
      assert.deepEqual(actual.policy, { verdict: "INSTRUMENT", disposition: "operator-hold" });
      assert.match(actual.error, /diagnostic only: LoadState=loaded/);
      if (mode === "journal-failed") assert.match(actual.error, /unit journal unavailable: injected journal failure/);
      else if (mode === "journal-empty") assert.match(actual.error, /no unit journal entries/);
      else if (mode === "journal-throws") assert.match(actual.error, /unit journal unavailable: Error: injected journal spawn error/);
      else assert.match(actual.error, /Failed to create cgroup: Cannot allocate memory/);
      if (mode === "realization-cleanup") {
        assert.match(actual.error, /cleanup also failed: .*injected cleanup failure/);
        assert.ok(actual.causeMessages.some((message: string) => message.includes("injected cleanup failure")));
      }
      const journal = JSON.parse(actual.calls.find((call: string) => call.startsWith("journal:")).slice("journal:".length));
      assert.ok(journal.includes("--lines=20"));
      assert.match(journal[journal.indexOf("--since") + 1], /^\d{4}-\d\d-\d\dT/);
      assert.ok(journal[journal.indexOf("--unit") + 1].endsWith("-w0.slice"));
    }
  });
}

test("slice start realizes empty worker groups under ready-signalled CPU load", t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = fixtureEnvironment(t, writeOwnMemory(join(directory, "observations"), {
    resident: { kind: "live" }, scopePeak: { kind: "live" }, cpu: { kind: "live" }, clock: { kind: "live" }, pressure: { kind: "live" },
  }));
  const unit = `nts-test-880-realization-${randomUUID()}.service`;
  t.after(() => spawnTest("systemctl", ["--user", "stop", unit], { encoding: "utf8", env }));
  const member = `import {hostObservations} from ${JSON.stringify(new URL("../gate/host-observations.ts", import.meta.url).href)};
process.stdout.write(hostObservations().ownCgroup());`;
  const code = `import assert from 'node:assert/strict';
import {MemoryRun} from ${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)};
import {startCpuLoad} from ${JSON.stringify(new URL("../gate/cpu-load.ts", import.meta.url).href)};
import {spawnTest} from ${JSON.stringify(new URL("../gate/test-wait.ts", import.meta.url).href)};
import {hostObservations,CgroupDeparted} from ${JSON.stringify(new URL("../gate/host-observations.ts", import.meta.url).href)};
const load=await startCpuLoad(4);
const host=hostObservations();
let run;
try {
 assert.ok(load.progress().every(value=>value>0),'all load workers acknowledged completed work');
 run=new MemoryRun({budgetBytes:256*2**20,id:'realization-under-load'});
 host.acquireCgroup(run.group);
 const groups=[run.group];
 for(let index=0;index<4;index++){
  const worker=run.worker(index,64*2**20);
  groups.push(worker.group);
  assert.ok(worker.group.startsWith(run.group+'/'));
  assert.equal(host.cgroupText(worker.group,'cgroup.events').includes('populated 0'),true,'the empty slice was realized before its first member');
  assert.ok(host.cgroupCpu(worker.group).usageUsec>=0);
  const scope=worker.scope(process.execPath,['--input-type=module','-e',${JSON.stringify(member)}]);
  const child=spawnTest('systemd-run',scope.argv,{env:scope.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.ok(child.stdout.trim().startsWith(worker.group+'/'));
  assert.ok(worker.ready(scope));worker.stop(scope);worker.close();await worker.closed;
 }
 run.close();await run.closed;
 for(const group of groups)assert.throws(()=>host.acquireCgroup(group),error=>error instanceof CgroupDeparted&&error.group===group,'all groups drained under load');
 process.stdout.write(JSON.stringify({groups:groups.length,load:load.progress()}));
}finally{try{if(run){run.close();await run.closed;}}finally{await load.close();}}`;
  const script = join(directory, "realization.mjs");
  writeFileSync(script, code);
  const result = spawnTest("systemd-run", ["--user", "--collect", "--wait", "--pipe", "--quiet", `--unit=${unit}`,
    ...toolingSliceArgs(env, "agent"), ...systemdEnvironment(env),
    ...Object.entries(env).filter(([, value]) => value !== undefined).map(([key, value]) => `--setenv=${key}=${value}`),
    "-p", "Nice=19", "-p", "CPUWeight=20", "-p", "RuntimeMaxSec=300", "-p", "LimitCORE=0",
    "taskset", "-c", "0-3,6-31", process.execPath, script], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.groups, 5);
  assert.equal(actual.load.length, 4);
  assert.ok(actual.load.every((value: number) => value > 0));
});


test("an exclusive case exceeding its step aggregate is a named failure, never pressure", t => {
  const directory = scratch(); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = join(directory, "exclusive.ts");
  writeFileSync(script, `import {serialRun,compileSync} from ${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)};
await serialRun({memoryCapKb:1024*1024});
compileSync({memoryCapKb:1024*1024}, "python3", ["-c", "held=bytearray(256*1024**2); print(len(held))", "named-budget-case"], {encoding:"utf8"});
`);
  const result = spawnTest(process.execPath, [script], { encoding: "utf8", env: { ...fixtureEnvironment(t),
    NTS_GATE_STEP: "outcomes", NTS_GATE_STEP_MEMORY_BYTES: String(128 * 2 ** 20),
    NTS_GATE_STEP_RESULT: join(directory, "instrument.json"), NTS_GATE_STEP_ATTEMPT: directory,
    NTS_CENSUS_POOL_WORKER: "0", NTS_CENSUS_WORKER_GROUP: "", NTS_CENSUS_RUN_GROUP: "" } });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const record = JSON.parse(readFileSync(join(directory, "instrument.json"), "utf8"));
  assert.equal(record.verdict, "FAIL"); assert.equal(record.kind, "case-budget");
  assert.match(record.reason, /named-budget-case.*exceeds the outcomes step's 134217728 byte budget/);
});

test('a yielding resident pool releases successive heads and resumes each remaining case once',async t=>{
 const directory=scratch();t.after(()=>rmSync(directory,{recursive:true,force:true}));
 writeOwnMemory(memoryDirectory,{availableKiB:22.0625*2**20,totalKiB:32*2**20,clock:{kind:'live'}});
 t.after(()=>writeOwnMemory(memoryDirectory,{availableKiB:8*2**20,totalKiB:32*2**20}));
 const key='priority-idle-worker',memory=new MemoryRun({budgetBytes:4*2**30,id:key}),gate=await gatePool(1),rows:{path:string;pid:number;waitingInLedger?:number}[]=[],reports:string[]=[];
 const clock=hostObservations(ownMemory),tick=()=>clock.now();
 const restarts:number[]=[];let readmittedAt=0;
 assert.equal(writeCostHistory(historyFile(process.env),{jobs:[{key,peak:3*2**30,basis:'worker',width:1}]}),undefined);
 const independent:NodeJS.ProcessEnv={...fixtureEnvironment(t),...ownMemory};delete independent.NTS_MEMORY_RESERVATION;
 let higher:Awaited<ReturnType<typeof reserve>>|undefined;
 const pool=runMemoryWorkers({paths:['gate-a','gate-b','probe-ledger'],jobs:1,memory,workerBytes:64*2**20,key,
  token:gate.token,args:index=>[fixture,directory,String(index)],onRow:row=>{rows.push(row);if(row.path==='probe-ledger')restarts.push(tick()-readmittedAt);},report:line=>{
   reports.push(line);
   if(line.startsWith('case cohort resumed'))readmittedAt=tick();
   if(line.startsWith('case cohort yielded:')){
    const children=readdirSync(join(CGROUP,memory.group),{withFileTypes:true}).filter(entry=>entry.isDirectory());
    assert.deepEqual(children,[],'idle worker slices must be joined before the model returns their physical memory');
    const own=readLedger(ownMemory.NTS_MEMORY_LEDGER).admitted.find(entry=>entry.what.includes('resident workers'));
    assert.ok(own);assert.equal(own.bytes,peakReservation([1]));
    writeOwnMemory(memoryDirectory,{availableKiB:25.0625*2**20,totalKiB:32*2**20});
   }
  }});
 try{
  for(const [index,path] of ['gate-a','gate-b'].entries()){
   await waitFor('resident case ready: '+path,()=>existsSync(join(directory,'ready-'+path)));
   if(index>0)restarts.push(tick()-readmittedAt);
   writeOwnMemory(memoryDirectory,{availableKiB:22.0625*2**20,totalKiB:32*2**20});
   higher=await reserve({bytes:12*2**30,what:'higher landing '+index,priority:'landing'},{env:independent});
   const grown=higher.grow(8*2**30);void grown.catch(()=>{});
   await waitFor('higher growth waiting behind the resident cohort',()=>readLedger(ownMemory.NTS_MEMORY_LEDGER).waiting.some(entry=>entry.grows===higher!.id));
   writeFileSync(join(directory,'go-'+path),'go');
   await grown;assert.equal(higher.bytes,20*2**30,'the higher request was admitted, not withdrawn');
   await waitFor('lower job ordinary readmission after idle close',()=>readLedger(ownMemory.NTS_MEMORY_LEDGER).waiting.some(entry=>entry.grows&&entry.grows!==higher!.id));
   assert.equal(rows.length,index+1,'a new worker cannot boot before normal memory readmission');
   higher.release();await higher.closed;
  }
  const summary=await pool;await gate.settled();
  assert.deepEqual(rows.map(row=>row.path),['gate-a','gate-b','probe-ledger']);assert.equal(new Set(rows.map(row=>row.pid)).size,3,'each admitted cohort uses a fresh worker');
  assert.equal(rows[2]!.waitingInLedger,0);
  assert.equal(summary.pressureRequeues,0);assert.equal(summary.idlePressureRestarts,0);assert.equal(summary.isolatedReplays,0);
  assert.equal(reports.filter(line=>line.startsWith('case cohort yielded:')).length,2);
  assert.equal(reports.filter(line=>line.startsWith('case cohort resumed')).length,2);
  assert.equal(gate.seen.grant,3);assert.equal(gate.seen.release,3);assert.equal(existsSync(join(CGROUP,memory.group)),false);
  t.diagnostic('lightweight worker restart after ordinary readmission: '+JSON.stringify({wallMs:restarts,cumulativeWallMs:restarts.reduce((a,b)=>a+b,0),scope:'real private worker; no SDK startup; readings do not decide the verdict'}));
 }finally{higher?.release();await higher?.closed;memory.close();await memory.closed;await pool.catch(()=>{});await gate.close();}
});

for (const family of [false, true]) test(`inside a gate step's bounded worker subtree, the supervisor records pressure from ${family ? "a worker process family" : "one worker"}`, async t => {
  // The worker subtree holds 256 MiB. The supervisor's sibling has its
  // own runaway bound, so even a second OOM while victim pages drain stays
  // inside the workers. An oracle worker and its SDK child die as one group.
  const { GateScopes } = await import("../gate/scopes/step-scope.ts");
  const owner = new GateScopes(process.env,{rank:"agent"}), slice = owner.step({ max: 256 * 2 ** 20 });
  t.after(async () => { await slice.drain(); owner.close(); });
  const allocation = "const held = Buffer.alloc(400 * 2 ** 20, 1); console.log(held.length)";
  const census = `import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const { MemoryRun, memoryCause } = await import(${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)});
const memory = new MemoryRun({ id: "capped-step" });
const own = readFileSync("/sys/fs/cgroup" + memory.group + "/memory.max", "utf8").trim(), effective = memory.effectiveBudgetBytes();
// A worker whose own cap is above the step's: the step's bound fires first.
const worker = memory.worker("over", 512 * 2 ** 20);
const before = worker.counters(), aggregateBefore = memory.aggregateOoms();
const allocation = "const held = Buffer.alloc(400 * 2 ** 20, 1); console.log(held.length)";
const work = \`const fs = require("node:fs");
const group = fs.readFileSync("/proc/self/cgroup", "utf8").trim().replace(/^0::/, "");
console.log("oom_group " + fs.readFileSync("/sys/fs/cgroup" + group + "/memory.oom.group", "utf8").trim());
${family ? 'require("node:child_process").spawnSync(process.execPath, ["-e", ' + JSON.stringify(allocation) + '], {stdio: "inherit"}); console.log("worker family survived");' : allocation}\`;
const scope = worker.scope(process.execPath, ["-e", work]);
const killed = spawnSync("systemd-run", scope.argv, { env: scope.env, encoding: "utf8" });
let cause;
try { cause = memoryCause(before, worker.counters(), aggregateBefore, memory.aggregateOoms()); }
catch (error) { if (!String(error).includes("resident ancestor-cap:")) throw error; cause = error.message; }
worker.stop(scope);
memory.close();
console.log(JSON.stringify({ own, effective, status: killed.status, cause, group: memory.group,
  supervisor: readFileSync("/proc/self/cgroup", "utf8").trim().replace(/^0::/, ""),
  workerOutput: killed.stdout, workerError: killed.stderr }));`;
  const launch = slice.command(process.execPath, ["--input-type=module", "-e", census]);
  const ran = spawnTest(launch.command, launch.args, { encoding: "utf8",
    env: { ...fixtureEnvironment(t), NTS_TOOLING_SLICE: slice.slice, NTS_GATE_STEP_MEMORY_BYTES: String(512 * 2 ** 20) } }, "the step's census");
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const seen = JSON.parse(ran.stdout.trim().split("\n").at(-1)!) as { own: string; effective: number; status: number; cause: string; group: string;
    supervisor: string; workerOutput: string; workerError: string };
  assert.ok(seen.supervisor.startsWith(slice.supervisorGroup + "/"));
  assert.ok(seen.group.startsWith(slice.workerGroup + "/"));
  assert.equal(readFileSync(join(CGROUP, slice.group, "memory.max"), "utf8").trim(), "max");
  assert.match(seen.workerOutput, /oom_group 1/, seen.workerError);
  assert.doesNotMatch(seen.workerOutput, /worker family survived/);
  assert.equal(seen.own, "max", "no cap of its own beneath the step's");
  assert.ok(seen.group.startsWith(`${slice.group}/`));
  assert.equal(seen.effective, 256 * 2 ** 20, "the step's bound is its ceiling");
  assert.notEqual(seen.status, 0, "the case was killed");
  assert.match(seen.cause, /resident ancestor-cap:/);
  assert.ok(seen.cause.includes(slice.workerGroup),seen.cause);
  assert.match(seen.cause, /cap 268435456 bytes.*case cap is 268435456 bytes/);
  // A census given a budget of its own keeps its own cap, wherever it runs.
  const fixture = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "own-budget" });
  try { assert.notEqual(readFileSync(join(CGROUP, fixture.group, "memory.max"), "utf8").trim(), "max"); }
  finally { fixture.close(); }
});

// #633: slices bound to the unit their process runs in stop with it. The
// census below never closes its run: it is killed, its unit stopped, and
// none of its slices may stay loaded.
test("a census killed inside its unit leaves none of its slices once that unit stops", { timeout: TEST_HANG_MS }, async t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const unit = `nts-test-633-killed-${process.pid}-${Math.floor(Math.random() * 1e9)}.service`;
  const ready = join(directory, "ready.json");
  const ctl = (...args: string[]) => spawnTest("systemctl", ["--user", ...args], { encoding: "utf8" });
  const show = (name: string, property: string) => ctl("show", name, `--property=${property}`, "--value").stdout.trim();
  let slices: string[] = [];
  t.after(() => {
    for (const name of [unit, ...slices]) { try { ctl("stop", name); } catch { /* already gone */ } }
  });
  const census = `import {durableRecord} from ${JSON.stringify(new URL("../gate/durable-record.ts",import.meta.url).href)};
const { MemoryRun } = await import(${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)});
const run = new MemoryRun({ budgetBytes: 128 * 2 ** 20, id: "killed633" });
const worker = run.worker(0, 64 * 2 ** 20);
durableRecord(${JSON.stringify(ready)}, { slice: run.slice, worker: worker.slice });
setInterval(() => {}, 60_000);`;
  // The enclosing test slice stops this service if its test process aborts.
  // The runtime bound also covers a plain node --test without a slice owner.
  const started = spawnTest("systemd-run", ["--user", ...toolingSliceArgs(process.env,"agent"), `--unit=${unit}`, "--collect", "--quiet",
    "-p", "RuntimeMaxSec=300s", "-p", "LimitCORE=0", process.execPath, "--input-type=module", "-e", census], { encoding: "utf8" }, "the killed census's unit");
  assert.equal(started.status, 0, started.stderr);
  const parentSlice=toolingSlice();
  if(parentSlice)assert.equal(show(unit,"Slice"),parentSlice,"the run owns the fixture even if its test aborts");
  assert.equal(show(unit,"RuntimeMaxUSec"),"5min","a plain test run still has a lifetime bound");
  await waitFor("the census's slices named in its ready file", () => existsSync(ready));
  const named = JSON.parse(readFileSync(ready, "utf8")) as { slice: string; worker: string };
  slices = [named.slice, named.worker];
  assert.equal(show(named.slice, "BindsTo"), unit, "the aggregate binds to the unit its process runs in");
  assert.equal(show(named.worker, "BindsTo"), named.slice, "a worker binds to its aggregate");
  ctl("kill", "--signal=SIGKILL", unit);
  ctl("stop", unit);
  // Unloaded reads from the unit list, not `show`: showing a collected
  // slice loads it again by name to answer.
  const listed = () => (JSON.parse(ctl("list-units", "--all", "--type=slice", "--output=json").stdout) as { unit: string }[]).map(u => u.unit);
  for (const slice of slices) {
    await waitFor(`${slice} unloaded with its unit`, () => !listed().includes(slice));
  }
});

test("startup pressure returns the reserved first case before a fresh generation",{timeout:TEST_HANG_MS},async t=>{
 const directory=scratch();t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const actual=new MemoryRun({budgetBytes:192*2**20,id:'startup-offer-control'}),gate=await gatePool(1);t.after(gate.close);
 const rows:any[]=[],reports:string[]=[],groups:string[]=[];let generations=0,killed=false;
 const forward=(target:object,key:string|symbol)=>{const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;};
 // Supplied pressure observations exercise classification. The scope being
 // stopped and joined is real; this is not a claim of a kernel OOM.
 const memory=new Proxy(actual,{get(run,key){
  if(key==='aggregateOoms')return()=>run.aggregateOoms()+Number(killed);
  if(key!=='worker')return forward(run,key);
  return(index:string|number,bytes:number)=>{
   if(generations>0){assert.equal(killed,true);assert.equal(existsSync(join(CGROUP,groups[0]!)),false,'first generation was not joined');assert.equal(gate.seen.release,1,'unused first grant was not returned');}
   const worker=run.worker(index,bytes),first=generations++===0;groups.push(worker.group);
   return new Proxy(worker,{get(inner,name){
    if(name==='counters')return()=>{const counters=inner.counters();return {...counters,kills:counters.kills+Number(first&&killed)};};
    if(name==='ready'&&first)return(scope:Parameters<typeof inner.ready>[0])=>{
     if(!killed&&inner.ready(scope)){killed=true;inner.stop(scope);}
     return false;
    };
    return forward(inner,name);
   }});
  };
 }});
 const summary=await runMemoryWorkers({paths:['one'],jobs:1,memory,workerBytes:96*2**20,token:gate.token,
  args:index=>[fixture,directory,String(index)],onRow:row=>rows.push(row),report:line=>reports.push(line)});
 assert.equal(generations,2);assert.deepEqual(rows.map(row=>[row.path,row.bucket]),[['one','strict-pass']]);
 assert.ok(reports.some(line=>line.includes('idle worker 0 killed by aggregate-pressure')));
 assert.ok(reports.some(line=>line.includes('idle restarts 1')));
 for(const group of groups)assert.equal(existsSync(join(CGROUP,group)),false);
 assert.equal(existsSync(join(CGROUP,actual.group)),false);await gate.settled();
 assert.deepEqual(gate.seen,{request:2,grant:2,release:2,cancel:0});
 assert.equal(summary.returnedOffers,1,JSON.stringify({summary,history:gate.history}));
});

test('a warm offer returned after scope attachment is counted once before its replacement dispatch',async t=>{
 const directory=scratch();t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const actual=new MemoryRun({budgetBytes:192*2**20,id:'warm-offer-return'}),rows:any[]=[],groups:string[]=[];
 const observedClose=Promise.withResolvers<void>();let generations=0,attachments=0,killed=false;
 let captured:{worker:ReturnType<MemoryRun['worker']>;scope:ReturnType<ReturnType<MemoryRun['worker']>['scope']>}|undefined;
 const forward=(target:object,key:string|symbol)=>{const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;};
 // Pressure counters are supplied; stopping and joining the warm generation
 // uses its actual scope. No machine-wide OOM or scheduling delay decides it.
 const memory=new Proxy(actual,{get(run,key){
  if(key==='aggregateOoms')return()=>run.aggregateOoms()+Number(killed);
  if(key!=='worker')return forward(run,key);
  return(index:string|number,bytes:number)=>{
   const worker=run.worker(index,bytes),first=generations++===0;groups.push(worker.group);
   return new Proxy(worker,{get(inner,name){
    if(name==='counters')return()=>{const counters=inner.counters();return {...counters,kills:counters.kills+Number(first&&killed)};};
    if(name==='scope')return(...args:Parameters<typeof inner.scope>)=>{const scope=inner.scope(...args);if(first)captured={worker:inner,scope};return scope;};
    return forward(inner,name);
   }});
  };
 }});
 const gate=await gatePool(1,async()=>{
  if(++attachments!==2)return;
  assert.deepEqual(rows.map(row=>row.path),['warm-first']);assert.ok(captured);
  killed=true;captured.worker.stop(captured.scope);await observedClose.promise;
 });t.after(gate.close);
 const summary=await runMemoryWorkers({paths:['warm-first','warm-second'],jobs:1,memory,workerBytes:96*2**20,token:gate.token,
  args:index=>[fixture,directory,String(index)],onRow:row=>rows.push(row),
  report:line=>{if(line.startsWith('resident pressure: idle worker '))observedClose.resolve();}});
 assert.deepEqual(rows.map(row=>[row.path,row.bucket]),[['warm-first','strict-pass'],['warm-second','strict-pass']]);
 assert.equal(generations,2);assert.equal(summary.returnedOffers,1,JSON.stringify({summary,history:gate.history}));
 assert.equal(summary.pressureRequeues,0);assert.equal(summary.idlePressureRestarts,1);assert.equal(summary.isolatedReplays,0);
 await gate.settled();assert.deepEqual(gate.seen,{request:3,grant:3,release:3,cancel:0});
 for(const group of groups)assert.equal(existsSync(join(CGROUP,group)),false);
 assert.equal(existsSync(join(CGROUP,actual.group)),false);
});

test('a case offered to a worker OOM-killed while idle, before its close is observed, returns to the feed instead of being lost',async t=>{
 const directory=scratch();t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const actual=new MemoryRun({budgetBytes:192*2**20,id:'idle-kill-offer'}),rows:any[]=[],reports:string[]=[],groups:string[]=[];
 let generations=0,attachments=0,killed=false;
 let captured:{worker:ReturnType<MemoryRun['worker']>;scope:ReturnType<ReturnType<MemoryRun['worker']>['scope']>}|undefined;
 const forward=(target:object,key:string|symbol)=>{const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;};
 // The kill's counters are supplied and its scope is really stopped, as an
 // aggregate OOM leaves an idle worker: counted, dying, its close not yet
 // seen when the next case's token arrives (the trigger's in the idle
 // pressure case). No scheduling delay decides it.
 const memory=new Proxy(actual,{get(run,key){
  if(key==='aggregateOoms')return()=>run.aggregateOoms()+Number(killed);
  if(key!=='worker')return forward(run,key);
  return(index:string|number,bytes:number)=>{
   const worker=run.worker(index,bytes),first=generations++===0;groups.push(worker.group);
   return new Proxy(worker,{get(inner,name){
    if(name==='counters')return()=>{const counters=inner.counters();return {...counters,kills:counters.kills+Number(first&&killed)};};
    if(name==='scope')return(...args:Parameters<typeof inner.scope>)=>{const scope=inner.scope(...args);if(first)captured={worker:inner,scope};return scope;};
    return forward(inner,name);
   }});
  };
 }});
 const gate=await gatePool(1,async()=>{
  if(++attachments!==2)return;
  assert.deepEqual(rows.map(row=>row.path),['quiet-first']);assert.ok(captured);
  killed=true;captured.worker.stop(captured.scope);
 });t.after(gate.close);
 const summary=await runMemoryWorkers({paths:['quiet-first','quiet-second'],jobs:1,memory,workerBytes:96*2**20,token:gate.token,
  args:index=>[fixture,directory,String(index)],onRow:row=>rows.push(row),report:line=>reports.push(line)});
 assert.deepEqual(rows.map(row=>[row.path,row.bucket]),[['quiet-first','strict-pass'],['quiet-second','strict-pass']]);
 assert.notEqual(rows[1].pid,rows[0].pid,'the returned case ran in a fresh generation, never in the killed one');
 assert.ok(reports.some(line=>line.includes('idle worker 0 killed by aggregate-pressure')),reports.join('\n'));
 assert.equal(generations,2);assert.equal(summary.returnedOffers,1,JSON.stringify({summary,history:gate.history}));
 assert.equal(summary.pressureRequeues,0);assert.equal(summary.idlePressureRestarts,1);assert.equal(summary.isolatedReplays,0);
 await gate.settled();assert.deepEqual(gate.seen,{request:3,grant:3,release:3,cancel:0});
 for(const group of groups)assert.equal(existsSync(join(CGROUP,group)),false);
 assert.equal(existsSync(join(CGROUP,actual.group)),false);
});

test('an idle own-limit OOM counted without a kill stops its worker before a case is offered, and fails by name',{timeout:TEST_HANG_MS},async t=>{
 const directory=scratch();t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const actual=new MemoryRun({budgetBytes:192*2**20,id:'idle-oom-offer'}),rows:any[]=[],groups:string[]=[];
 let generations=0,attachments=0,moved=false;
 const forward=(target:object,key:string|symbol)=>{const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;};
 // The kernel counts MEMCG_OOM before it chooses a victim, and may choose
 // none: the worker's own `oom` moves, its kills do not, and its process
 // lives on with stdin open. Only the pool stopping it can bring its close.
 const memory=new Proxy(actual,{get(run,key){
  if(key!=='worker')return forward(run,key);
  return(index:string|number,bytes:number)=>{
   const worker=run.worker(index,bytes),first=generations++===0;groups.push(worker.group);
   return new Proxy(worker,{get(inner,name){
    if(name==='counters')return()=>{const counters=inner.counters();return {...counters,oom:counters.oom+Number(first&&moved)};};
    return forward(inner,name);
   }});
  };
 }});
 const gate=await gatePool(1,async()=>{if(++attachments===2){assert.deepEqual(rows.map(row=>row.path),['quiet-first']);moved=true;}});t.after(gate.close);
 let failure:unknown,settled=false;
 void runMemoryWorkers({paths:['quiet-first','quiet-second'],jobs:1,memory,workerBytes:96*2**20,token:gate.token,
  args:index=>[fixture,directory,String(index)],onRow:row=>rows.push(row)}).then(()=>{settled=true;},error=>{failure=error;settled=true;});
 // The pool settles within a second once it stops the worker; a pool that
 // leaves it alive waits for a close that never comes. Fail that by name,
 // then close the run, whose stopped scopes bring the close, so the
 // failure holds no worker, token or slice past its bound.
 try{await waitFor('the pool to settle after its idle worker\'s own-limit OOM',()=>settled,{timeoutMs:OWN_LIMIT_SETTLE_MS});}
 catch(missing){
  actual.close();let unsettled:unknown;
  try{await waitFor('the pool to settle after the test closed its run',()=>settled,{timeoutMs:OWN_LIMIT_SETTLE_MS});}catch(error){unsettled=error;}
  throw new Error(`${(missing as Error).message}${unsettled===undefined?'':`\n${(unsettled as Error).message}`}`,{cause:missing});
 }
 assert.match(String((failure as Error)?.message),/resident instrument failure: idle worker 0 reached its own limit without an in-flight case/);
 assert.deepEqual(rows.map(row=>row.path),['quiet-first'],'the offered case never ran in the worker that hit its own limit');
 assert.equal(generations,1);
 await gate.settled();assert.equal(gate.seen.release,gate.seen.grant,JSON.stringify(gate.seen));
 for(const group of groups)assert.equal(existsSync(join(CGROUP,group)),false);
 assert.equal(existsSync(join(CGROUP,actual.group)),false);
});
