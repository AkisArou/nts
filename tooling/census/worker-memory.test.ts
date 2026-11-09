import { spawnTest, testProcessResult, TEST_HANG_MS, waitFor } from "../gate/test-wait.ts";
import assert from "node:assert/strict";
import { constants, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { capped } from "./attempt262.ts";
import { readLedger, reserve } from "../gate/memory-ledger.ts";
import { useOwnMemory } from "../gate/test-memory.ts";
import { createTokenPool } from "../gate/tokenpool.mjs";
import { tokenClient } from "../gate/tokens.mjs";
import { compileSync, compileActive, memoryCause, MemoryRun, memoryRun } from "./worker-memory.ts";
import { runMemoryWorkers } from "./worker-pool.ts";
import { newTestScratch } from "../gate/test-scratch.ts";

// The pools here reserve their memory in a ledger of this file's own, against
// an 8 GiB reading, never the machine's.
const memoryDirectory = newTestScratch("resident-run-memory");
after(() => rmSync(memoryDirectory, { recursive: true, force: true }));
const ownMemory = useOwnMemory(memoryDirectory, { availableKiB: 8 * 2 ** 20, totalKiB: 32 * 2 ** 20 });
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
 * A real gate token pool of `n` (tokenpool.mjs, as run.mjs serves it) and a
 * client of it as the resident pool's token policy, with the pool's own
 * request, grant, release and cancel counts.
 */
async function gatePool(n: number) {
  const seen = { request: 0, grant: 0, release: 0, cancel: 0 };
  const pool: any = createTokenPool({
    free: () => n - pool.total,
    claim: (_step: string, { waitedS }: { waitedS: number }) => waitedS,
    observe: ({ event }: { event: string }) => {
      const key = event.replace(/^token\./, "") as keyof typeof seen;
      if (key in seen) seen[key]++;
    },
  });
  await pool.start();
  const client = tokenClient(pool.addr, "typescript-c");
  return {
    seen,
    waiting: () => pool.waiting.length as number,
    token: (path: string, signal: AbortSignal) => client.acquire({ project: path }, signal),
    /** Every control ends here: no token held, no request waiting. */
    settled: () => waitFor("every token returned and no request waiting", () => pool.total === 0 && pool.waiting.length === 0),
    close: () => pool.close(),
  };
}

/**
 * A landing check's request in this file's ledger and reading, made at once:
 * it is waiting when this returns, and withdrawn when test `t` ends. It is a
 * job of its own, not one inside a pool's reservation, which this process
 * names while the pool runs. Its 7 GiB does not fit beside a pool in the
 * 8 GiB read less the 2 kept for the system, so it outranks the pool until it
 * is withdrawn; `ended` settles once it has.
 */
function landingAhead(t: { after(fn: () => void): void }): { withdraw: () => void; ended: Promise<unknown> } {
  const ahead = new AbortController(), env: NodeJS.ProcessEnv = { ...process.env, ...ownMemory };
  delete env.NTS_MEMORY_RESERVATION;
  t.after(() => ahead.abort());
  const ended = reserve({ bytes: 7 * 2 ** 30, what: "landing", priority: "landing" }, { env, signal: ahead.signal, everyMs: 50 });
  ended.catch(() => {});
  if (readLedger(ownMemory.NTS_MEMORY_LEDGER).waiting.length !== 1) {
    ahead.abort();
    assert.fail("the landing request does not wait in the ledger");
  }
  return { withdraw: () => ahead.abort(), ended };
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
  assert.equal(rows.every(row=>row.bucket==='strict-pass'),true);
  await gate.settled();assert.equal(gate.seen.grant,paths.length);assert.equal(gate.seen.release,paths.length);
  assert.equal(existsSync(join(CGROUP,memory.group)),false,'all worker generations drain before the pool finishes');
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
    env: { ...process.env, NTS_GATE_RUN_DIR: directory, NTS_GATE_CASE_COSTS_DIR: costs, NTS_GATE_STEP: "peak-control" } });
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
  const activeModule = new URL("../gate/active-command.ts", import.meta.url).href;
  const memoryModule = new URL("./worker-memory.ts", import.meta.url).href;
  const code = `import assert from 'node:assert/strict';import {mock} from 'node:test';
const real=await import(${JSON.stringify(activeModule)});let expected;
mock.module(${JSON.stringify(activeModule)},{namedExports:{...real,activeCommand:(command,args,options)=>{
 for(const key of ['idleMs','pollMs','cpuBudgetSeconds','onActivity'])assert.equal(options[key],expected[key],key+' was dropped');
 return real.activeCommand(command,args,options);
}}});
const {compileActive,memoryRun}=await import(${JSON.stringify(memoryModule)});
const env={...process.env,NTS_GATE_STEP:'resident-bridge',NTS_GATE_STEP_ATTEMPT:'control',NTS_GATE_STEP_RESULT:${JSON.stringify(join(directory, "instrument.json"))}};
try{
 expected={idleMs:1000,pollMs:50,cpuBudgetSeconds:0.1,onActivity(){}};
 await assert.rejects(compileActive({memoryCapKb:64*1024},'python3',['-c','while True: pass'],{env,...expected}),e=>e instanceof real.CommandNotMeasuredError&&e.kind==='runaway');
 expected={idleMs:500,pollMs:50,cpuBudgetSeconds:10,onActivity(){}};
 await assert.rejects(compileActive({memoryCapKb:64*1024},'python3',['-c','import time;time.sleep(3600)'],{env,...expected}),e=>e instanceof real.CommandNotMeasuredError&&e.kind==='hung');
}finally{memoryRun().close();}
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
  for (const path of ["pressure-a", "pressure-b"]) {
    const fifo = spawnTest("mkfifo", [join(directory, `release-${path}`)], { encoding: "utf8" });
    assert.equal(fifo.status, 0, fifo.stderr);
  }
  const memory = new MemoryRun({ budgetBytes: 768 * 2 ** 20, id: "aggregate-oom-control" });
  const gate = await gatePool(2);
  t.after(gate.close);
  const rows: any[] = [];
  const reports: string[] = [];
  const summary = await runMemoryWorkers({
    paths: ["pressure-a", "pressure-b"], jobs: 2, memory, workerBytes: 640 * 2 ** 20,
    token: gate.token,
    args: (index) => [fixture, directory, String(index)],
    onRow: (row) => rows.push(row),
    report: message => {
      reports.push(message);
      if (message.startsWith("resident pressure: requeued ")) {
        for (const path of ["pressure-a", "pressure-b"]) {
          try { writeFileSync(join(directory, `release-${path}`), "x", { flag: constants.O_WRONLY | constants.O_NONBLOCK }); }
          catch (error) { if (error.code !== "ENXIO") throw error; } // A killed reader has no wait to release.
        }
      }
    },
  });
  assert.deepEqual(rows.map(row => [row.path, row.bucket]).sort(), [["pressure-a", "strict-pass"], ["pressure-b", "strict-pass"]]);
  assert.equal(rows.length, 2, "each input has exactly one final verdict");
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

test("aggregate pressure restarts an idle worker without losing or replaying its completed case", { timeout: TEST_HANG_MS }, async t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of ["idle", "trigger"]) {
    const result = spawnTest("mkfifo", [join(directory, `release-${name}`)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const rows: any[] = [];
  const reports: string[] = [];
  const memory = new MemoryRun({ budgetBytes: 768 * 2 ** 20, id: "idle-pressure-control" });
  const gate = await gatePool(2);
  t.after(gate.close);
  let landing: ReturnType<typeof landingAhead> | undefined;
  const summary = await runMemoryWorkers({
    paths: ["idle-holder", "idle-trigger", "after"], jobs: 2, memory, workerBytes: 768 * 2 ** 20,
    args: index => [fixture, directory, String(index)],
    token: gate.token,
    onRow: row => {
      rows.push(row);
      if (row.path === "idle-holder") {
        // Its worker stays idle, asking no token for its next case, while a
        // request of higher priority waits ahead of the pool.
        landing = landingAhead(t);
        writeFileSync(join(directory, "idle-reported"), "idle");
      }
    },
    report: message => {
      reports.push(message);
      if (message.startsWith("resident pressure: idle worker ")) {
        landing?.withdraw();
        try { writeFileSync(join(directory, "release-trigger"), "x", { flag: constants.O_WRONLY | constants.O_NONBLOCK }); }
        catch (error) { if (error.code !== "ENXIO") throw error; } // The trigger may also be collateral damage.
      }
    },
  });
  assert.deepEqual(rows.map(row => [row.path, row.bucket]).sort(), [["after", "strict-pass"], ["idle-holder", "strict-pass"], ["idle-trigger", "strict-pass"]]);
  assert.equal(summary.idlePressureRestarts, 1, reports.join("\n"));
  assert.ok(summary.pressureRequeues <= 1, JSON.stringify(summary));
  assert.equal(summary.isolatedReplays, summary.pressureRequeues);
  assert.equal(rows.find(row => row.path === "idle-holder").residentPressureRetries, 0, "a completed case is never replayed");
  assert.ok(summary.aggregatePressureKills >= 1);
  assert.equal(summary.systemPressureKills, 0);
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
  await gate.settled();
  assert.equal(gate.seen.grant, 3 + summary.isolatedReplays, JSON.stringify({ seen: gate.seen, summary }));
  await assert.rejects(landing!.ended, { name: "AbortError" }, "the landing request ended only when it was withdrawn");
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
  // One token, two workers, two cases that hold it: one worker runs its case
  // and the other waits for the token with its case reserved.
  const run = runMemoryWorkers({ paths: ["hold-a", "hold-b"], jobs: 2, memory, workerBytes: 96 * 2 ** 20,
    token: gate.token,
    args: index => [fixture, directory, String(index)], onRow: () => {} });
  const busy = () => readdirSync(directory).filter(name => name.startsWith("busy-"));
  await waitFor("one worker holding the token and one waiting for it", () => busy().length === 1 && gate.waiting() === 1);
  const waiter = busy()[0] === "busy-0" ? 1 : 0;
  writeFileSync(join(directory, `exit-${waiter}`), "x");
  await assert.rejects(run, new RegExp(`worker ${waiter} exited 19 without an in-flight case; no OOM kill recorded`));
  assert.equal(existsSync(join(CGROUP, memory.group)), false);
  await gate.settled();
  assert.deepEqual({ request: gate.seen.request, grant: gate.seen.grant, cancel: gate.seen.cancel }, { request: 2, grant: 1, cancel: 1 });
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
  const result = spawnTest(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-nts-user-bus" },});
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes("UNCAPPED"));
  assert.match(result.stderr, /resident cap: user manager failed/);
});

test("a serial runner shares one scope across compiles and removes every cgroup", () => {
  const result = spawnTest(process.execPath, [join(HERE, "fixtures/resident-serial.ts")], { encoding: "utf8",});
  assert.equal(result.status, 0, result.stderr);
  const { groups, own, boundary } = JSON.parse(result.stdout);
  assert.deepEqual(groups, [own, own]);
  assert.equal(existsSync(join(CGROUP, boundary)), false);
  assert.equal(existsSync(join(CGROUP, dirname(boundary))), false);
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
  let root, rootLookups = 0;
  const remove = unit => {
    const held = units.get(unit);
    for (const [name, row] of units) if (name === unit || held && row.group.startsWith(held.group + "/")) units.delete(name);
  };
  const response = (stdout = "", status = 0, stderr = "") => ({ stdout, stderr, status });
  cp.spawnSync = (command, args, options) => {
    if (command === "busctl") {
      let at = args.indexOf("StartTransientUnit");
      if (at >= 0) {
        const unit = args[at + 2]; root ??= unit;
        const group = `/fake-user/${root}${unit === root ? "" : `/${unit}`}`;
        units.set(unit, { unit, group, bytes: Number(args[args.indexOf("MemoryMax") + 2]), ready: false, reads: 0 });
        calls.push(`create:${unit}`);
        return response('o "/fake-job"');
      }
      at = args.indexOf("StopUnit");
      if (at >= 0) {
        const unit = args[at + 2];
        calls.push(`stop:${unit}`);
        if (mode === "failed-cleanup" && unit !== root) return response("", 1, "injected cleanup failure");
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
        if (mode === "failed-cleanup" && unit !== root) return response("", 1, "injected start failure");
        row.ready = true;
        return response();
      }
      if (operation === "show") {
        if (!row.ready) throw new Error("ControlGroup read before joining start job");
        row.reads++;
        if (mode === "always-empty" && unit !== root || mode === "empty-once" && row.reads === 1) return response();
        return response(mode === "wrong-parent" && unit !== root ? `/someone-else/${unit}` : row.group);
      }
    }
    return original.spawn(command, args, options);
  };
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
  const run = new MemoryRun({ budgetBytes: 128 * 2 ** 20, id: "fake-manager" });
  let error = null, closeError = null, group = null;
  try { group = run.worker(0, 64 * 2 ** 20).group; }
  catch (caught) { error = String(caught); }
  finally {
    // Move a wall clock across the old readiness deadline without sleeping.
    // Job completion, not this clock, must decide whether cleanup is done.
    if (["queued-stop", "retained-stop"].includes(mode)) { let tick = 0; Date.now = () => tick += 4000; }
    try { run.close(); } catch (caught) { closeError = String(caught); }
  }
  process.stdout.write(JSON.stringify({ error, closeError, group, calls, rootLookups, remaining: units.size }));
}

for (const mode of ["empty-once", "always-empty", "wrong-parent", "failed-cleanup", "queued-stop", "retained-stop"]) {
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
    if (mode === "empty-once" || mode === "queued-stop") {
      assert.equal(actual.error, null);
      assert.equal(actual.closeError, null);
      assert.ok(actual.group.endsWith("-w0.slice"));
      if (mode === "queued-stop") assert.equal(actual.calls.filter(call => call.startsWith("stop-job-finished:")).length, 2);
    } else if (mode === "retained-stop") {
      assert.equal(actual.error, null);
    } else if (mode === "failed-cleanup") {
      assert.match(actual.error, /injected start failure/);
      assert.match(actual.error, /injected cleanup failure/);
    } else {
      assert.match(actual.error, /resident cap: .*?-w0.slice has no valid ControlGroup/);
      assert.doesNotMatch(actual.error, /cgroup was not removed/);
    }
  });
}


test("an exclusive case exceeding its step aggregate is a named failure, never pressure", t => {
  const directory = scratch(); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = join(directory, "exclusive.ts");
  writeFileSync(script, `import {serialRun,compileSync} from ${JSON.stringify(new URL("./worker-memory.ts", import.meta.url).href)};
serialRun({memoryCapKb:1024*1024});
compileSync({memoryCapKb:1024*1024}, "python3", ["-c", "held=bytearray(256*1024**2); print(len(held))", "named-budget-case"], {encoding:"utf8"});
`);
  const result = spawnTest(process.execPath, [script], { encoding: "utf8", env: { ...process.env,
    NTS_GATE_STEP: "outcomes", NTS_GATE_STEP_MEMORY_BYTES: String(128 * 2 ** 20),
    NTS_GATE_STEP_RESULT: join(directory, "instrument.json"), NTS_GATE_STEP_ATTEMPT: directory,
    NTS_CENSUS_POOL_WORKER: "0", NTS_CENSUS_WORKER_GROUP: "", NTS_CENSUS_RUN_GROUP: "" } });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  const record = JSON.parse(readFileSync(join(directory, "instrument.json"), "utf8"));
  assert.equal(record.verdict, "FAIL"); assert.equal(record.kind, "case-budget");
  assert.match(record.reason, /named-budget-case.*exceeds the outcomes step's 134217728 byte budget/);
});

test("a pool whose reservation is outranked starts no new case until the request ahead of it has gone", async t => {
  const directory = scratch();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = new MemoryRun({ budgetBytes: 192 * 2 ** 20, id: "outranked-pool" }), gate = await gatePool(1);
  t.after(gate.close);
  const rows: { path: string; waitingInLedger?: number }[] = [], asked: string[] = [];
  // The feed decides on the next case as soon as a row has been taken in; an
  // immediate callback from that row runs once it has.
  let decided!: () => void;
  const afterFirst = new Promise<void>(resolve => { decided = resolve; });
  const pool = runMemoryWorkers({
    paths: ["gate-a", "probe-ledger"], jobs: 1, memory, workerBytes: 64 * 2 ** 20,
    token: (path, signal) => { asked.push(path); return gate.token(path, signal); },
    args: (index: number) => [fixture, directory, String(index)],
    onRow: row => { rows.push(row); if (row.path === "gate-a") setImmediate(decided); },
  });
  await waitFor("the first case to run", () => existsSync(join(directory, "ready-gate-a")));
  const landing = landingAhead(t);
  writeFileSync(join(directory, "go-gate-a"), "go");
  await afterFirst;
  assert.deepEqual(asked, ["gate-a"], "the next case asked for no token while the pool was outranked");
  landing.withdraw();
  await pool;
  await assert.rejects(landing.ended, { name: "AbortError" });
  assert.deepEqual(rows.map(row => row.path), ["gate-a", "probe-ledger"]);
  assert.equal(rows[1]?.waitingInLedger, 0, "the next case started only once the landing request had gone");
  await gate.settled();
});
