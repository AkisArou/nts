import {testEnvironment} from "./test-environment.ts";
// The token pool driven through a hold with real token.sh clients; the census
// feed, which gives way while its job's reservation is outranked, with a real
// worker process on a pipe; and a run temporary's disk admission.
//
//   node --test tooling/gate/admission.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, renameSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createFeed, TemporaryAdmission, type TemporaryAdmissionSnapshot } from "./admission.ts";
import { captureRunTemporary } from "./run-temporary.ts";
import { createTokenPool } from "./token-pool.ts";
import { tokenClient } from "./tokens.mjs";
import { releaseToken } from "./case-context.ts";
import { waitFor } from "./test-wait.ts";
import { testScratch } from "./test-scratch.ts";
import {ownMemory} from './test-memory.ts';
import {hostObservations} from './host-observations.ts';
import {DiskCapacity,type TemporaryDiskLease} from './disk-capacity.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Whether the feed's job is outranked, which a test moves by assignment. */
function ranked(start = false) {
  const state = { outranked: start };
  return { state, outranked: () => state.outranked };
}

function temporaryFixture(t: { after(fn: () => void): void }) {
  const run = testScratch(t, "admission"), temporary = captureRunTemporary(run);
  return { run, temporary, path: join(temporary.path, "capture") };
}

test("both capture contexts reserve above the temporary floor, and memory is not theirs to admit", async t => {
  const { temporary, path } = temporaryFixture(t);
  const observations=join(temporary.path,'observations');
  const setFree=(freeBytes:number)=>ownMemory(observations,{disk:{freeBytes,freeInodes:100}});
  const env=setFree(60*2**30),host=hostObservations(env),capacity=new DiskCapacity({env,host});
  const options = { path, reservedBytes: 2 ** 30, host,capacity };
  const gate = new TemporaryAdmission({ ...options, context: { kind: "gate", temporary } });
  const standalone = new TemporaryAdmission({ ...options, context: { kind: "standalone" } });
  for(const free of [60,40.5,41]){
    setFree(free*2**30);
    for(const admission of [gate,standalone]){
      const attempt=await firstAnswer(admission);
      try{
        assert.equal(attempt.snapshot.admitted,free>=41);
        assert.equal(attempt.lease!==null,free>=41);
        assert.equal(attempt.snapshot.diskFloorBytes,40*2**30);
        assert.equal(attempt.snapshot.requiredFreeBytes,41*2**30);
        assert.equal('availableGiB' in attempt.snapshot,false,"a capture's memory is its job's reservation in the ledger");
      }finally{attempt.lease?.release();}
    }
  }
});

/** The admission's first answer: its lease at once, or its first refusal, at which the wait is aborted. */
async function firstAnswer(admission: TemporaryAdmission) {
  const stop = new AbortController();
  let refused: TemporaryAdmissionSnapshot | undefined;
  try {
    const admitted = await admission.acquire({ what: "test capture", signal: stop.signal, report: (_, snapshot) => { refused = snapshot; stop.abort(); } });
    return { snapshot: admitted.snapshot, lease: admitted.lease as TemporaryDiskLease | null };
  } catch (error) {
    if (!refused) throw error;
    return { snapshot: refused, lease: null };
  }
}

test("a refused temporary waits in one recorded wait that names its holders, reports once, and ends when admitted", async t => {
  const { temporary, path } = temporaryFixture(t);
  const observations = join(temporary.path, "observations");
  const setFree = (freeBytes: number) => ownMemory(observations, { disk: { freeBytes, freeInodes: 100 } });
  const env = setFree(41 * 2 ** 30), host = hostObservations(env), capacity = new DiskCapacity({ env, host });
  const holder = capacity.tryTemporary(join(temporary.path, "holder"), 2 ** 30);
  assert.ok(holder.lease);
  const admission = new TemporaryAdmission({ path, reservedBytes: 2 ** 30, host, capacity, context: { kind: "gate", temporary } });
  const lines: string[] = [];
  const waited = admission.acquire({ what: "test capture", everyMs: 10, report: line => lines.push(line) });
  await waitFor("the refused request's wait record", () => capacity.diskWaits().length === 1);
  const [wait] = capacity.diskWaits();
  assert.equal(wait!.pid, process.pid);
  assert.equal(wait!.what, "test capture");
  assert.deepEqual(wait!.holders, [{ kind: "temporary", path: join(temporary.path, "holder"), bytes: 2 ** 30 }]);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^disk: test capture waits for 1\.0 GiB of disk above the 40\.0 GiB floor: 41\.0 GiB free, 0\.0 GiB promised to builds, 1\.0 GiB to temporaries \(.*holder 1\.0 GiB\)$/);
  holder.lease.release();
  const admitted = await waited;
  try {
    assert.equal(admitted.snapshot.admitted, true);
    assert.deepEqual(capacity.diskWaits(), [], "admission ends the wait record");
    assert.equal(lines.length, 2);
    assert.match(lines[1]!, /^disk: test capture admitted after \d+ s$/);
  } finally { admitted.lease.release(); }
});

test("an aborted wait removes its record, and free disk admits with no record and no report", async t => {
  const { temporary, path } = temporaryFixture(t);
  const observations = join(temporary.path, "observations");
  const setFree = (freeBytes: number) => ownMemory(observations, { disk: { freeBytes, freeInodes: 100 } });
  const env = setFree(40.5 * 2 ** 30), host = hostObservations(env), capacity = new DiskCapacity({ env, host });
  const admission = new TemporaryAdmission({ path, reservedBytes: 2 ** 30, host, capacity, context: { kind: "gate", temporary } });
  const stop = new AbortController(), lines: string[] = [];
  const waited = admission.acquire({ what: "aborted capture", signal: stop.signal, everyMs: 10, report: line => lines.push(line) });
  await waitFor("the waiting record", () => capacity.diskWaits().length === 1);
  stop.abort();
  await assert.rejects(waited);
  assert.deepEqual(capacity.diskWaits(), [], "an abort mid-wait removes the record");
  assert.equal(lines.length, 1, "an aborted wait reports only its refusal");
  // Control: with room for it, the request is admitted at once.
  setFree(60 * 2 ** 30);
  const before = statSync(capacity.waitStateFile).ino;
  const admitted = await admission.acquire({ what: "free capture", report: line => assert.fail(`free disk reported ${line}`) });
  try { assert.equal(admitted.snapshot.admitted, true); assert.equal(statSync(capacity.waitStateFile).ino, before, "free disk writes no wait"); }
  finally { admitted.lease.release(); }
});

test("attempt, for an owner that cannot block on disk, keeps one recorded wait across refusals and ends it when admitted or told to", async t => {
  const { temporary, path } = temporaryFixture(t);
  const observations = join(temporary.path, "observations");
  const setFree = (freeBytes: number) => ownMemory(observations, { disk: { freeBytes, freeInodes: 100 } });
  const env = setFree(40.5 * 2 ** 30), host = hostObservations(env), capacity = new DiskCapacity({ env, host });
  const admission = new TemporaryAdmission({ path, reservedBytes: 2 ** 30, host, capacity, context: { kind: "gate", temporary } });
  const lines: string[] = [];
  assert.equal(admission.attempt({ what: "step temporary", report: line => lines.push(line) }), null);
  const [first] = capacity.diskWaits();
  assert.equal(admission.attempt({ what: "step temporary", report: line => lines.push(line) }), null);
  assert.deepEqual(capacity.diskWaits().map(wait => wait.id), [first!.id], "a second refusal keeps the one record");
  assert.equal(lines.length, 1, "and reports only the first");
  admission.endWait();
  assert.deepEqual(capacity.diskWaits(), [], "endWait ends it");
  assert.equal(admission.attempt({ what: "step temporary", report: line => lines.push(line) }), null, "a later refusal opens a new one");
  assert.equal(capacity.diskWaits().length, 1);
  setFree(60 * 2 ** 30);
  const admitted = admission.attempt({ what: "step temporary", report: line => lines.push(line) });
  try {
    assert.ok(admitted?.lease);
    assert.deepEqual(capacity.diskWaits(), [], "admission ends the record");
    assert.equal(capacity.heldTemporary(admitted.lease.id)?.path, path, "the claim is published, for the process it is handed to");
    assert.match(lines.at(-1)!, /^disk: step temporary admitted after \d+ s$/);
  } finally { admitted?.lease.release(); }
  assert.equal(capacity.heldTemporary(admitted!.lease.id), null, "a released claim is no longer held");
});

test("gate policy rejects a replaced registration and outside or escaping capture roots", async t => {
  const { run, temporary, path } = temporaryFixture(t);
  const env=ownMemory(join(run,'observations'),{disk:{freeBytes:60*2**30,freeInodes:100}}),host=hostObservations(env);
  const options = { context: { kind: "gate" as const, temporary }, reservedBytes: 2 ** 30, host,capacity:new DiskCapacity({env,host}) };
  assert.throws(() => new TemporaryAdmission({ ...options, path: join(run, "outside") }), /outside the registered/);
  mkdirSync(join(run, "outside"));
  symlinkSync(join(run, "outside"), join(temporary.path, "link"));
  assert.throws(() => new TemporaryAdmission({ ...options, path: join(temporary.path, "link", "capture") }), /ancestor escapes/);
  const admitted = new TemporaryAdmission({ ...options, path });
  const attempt=await admitted.acquire({what:"test capture"});
  try{
    renameSync(temporary.path, join(run, "previous-tmp"));mkdirSync(temporary.path);
    await assert.rejects(admitted.acquire({what:"test capture"}), /temporary directory was replaced/);
    assert.throws(() => new TemporaryAdmission({ ...options, path }), /temporary directory was replaced/);
  }finally{attempt.lease.release();}
});

test("token pool: a running case finishes through a hold, and the next waits until the hold ends", async () => {
  // run.mjs's `free`, with the slot arithmetic of a 4-slot run, held as a run
  // outranked in the memory ledger holds its tokens.
  const hold = { on: false };
  const pool = createTokenPool({
    width:4,free: () => (hold.on ? 0 : 4 - pool.total),
    claim: (_step: string, { waitedS }: { waitedS: number }) => waitedS,
    known: () => true,
  });
  const addr = await pool.start();
  assert.ok(addr,'the owned token server started');
  // Held-token state is cleared: inside the gate this test itself runs under a token.
  const env = { ...testEnvironment(), NTS_GATE_TOKENS: addr, NTS_GATE_STEP: "s", NTS_GATE_TOKEN_HELD: "" };
  const run = (script: string, delayStart = false) => {
    const command=join(HERE, "token.sh");
    // The first token request arrives after the old 300 ms assumption.
    const args=delayStart ? ["-c", 'sleep 0.35; exec "$@"', "_", command, "--step", "--", "sh", "-c", script] : ["--step", "--", "sh", "-c", script];
    const child = spawn(delayStart ? "sh" : command, args, { env, stdio: ["pipe", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    const done = new Promise<number | null>(resolve => child.on("close", resolve));
    return { child, done, output: () => output };
  };
  const running = run("printf ready; read release", true);
  let queued: ReturnType<typeof run> | undefined;
  try {
    await waitFor("the token holder's ready output", () => running.output() === "ready");
    hold.on = true; // no new case may start
    queued = run("printf resumed");
    await waitFor("the second token request", () => pool.waiting.length === 1);
    running.child.stdin.end("release\n");
    assert.equal(await running.done, 0, "the running case was not stopped by the hold");
    await waitFor("the running token's release", () => pool.total === 0);
    pool.grant();
    assert.equal(pool.total, 0, "nothing was granted while held");
    assert.equal(queued.output(), "");
    assert.equal(pool.waiting.length, 1);
    hold.on = false;
    pool.grant();
    assert.equal(await queued.done, 0);
    assert.equal(queued.output(), "resumed");
  } finally {
    if (!running.child.stdin.writableEnded) running.child.stdin.end("release\n");
    hold.on = false; pool.grant();
    await running.done;
    if (queued) await queued.done;
    pool.close();await pool.closed;
  }
});

test("census feed: a delayed running case finishes, the next path waits while the job is outranked, the last input closes at once", async () => {
  const job = ranked();
  // A real pipe, with a response deliberately later than the old 700 ms
  // readiness sleep. Scheduling latency must not decide whether it completed.
  const worker = spawn(
    process.execPath,
    ["-e", `require("readline").createInterface({ input: process.stdin }).on("line", (p) => setTimeout(() => console.log(JSON.stringify({ path: p, at: Date.now() })), 1200));`],
    {env:testEnvironment(), stdio: ["pipe", "pipe", "inherit"] },
  );
  let exited = false;
  worker.on("exit", () => { exited = true; });
  const closed = once(worker, "close"); // Includes the last stdout row.
  const queue = createFeed(["a", "b"], { outranked: job.outranked,pause:async()=>{},resume:async()=>{}, everyMs: 20 });
  const feed = () => queue.feed({ write: (p) => worker.stdin.write(`${p}\n`), end: () => worker.stdin.end(), exited: () => exited });
  const rows: { path: string; at: number }[] = [];
  const output = createInterface({ input: worker.stdout });
  output.on("line", (line) => {
    rows.push(JSON.parse(line));
    if (rows.length === 1) job.state.outranked = true; // a request ahead of the job arrives as the first case comes back
    void feed();
  });
  try {
    const firstRow = once(output, "line");
    await feed();
    assert.equal(queue.dispatched, 1);
    await Promise.race([firstRow, closed.then(() => { throw new Error("worker closed before its first row"); })]);
    assert.equal(rows.length, 1, "the first case completed");
    assert.equal(queue.dispatched, 1, "b was not dispatched while the job was outranked");
    const resumed = Date.now();
    job.state.outranked = false;
    assert.equal((await closed)[0], 0, "the worker's input closed after b without waiting again");
    assert.deepEqual(rows.map((r) => r.path), ["a", "b"]);
    assert.ok(rows[1].at >= resumed, "b started only once the job went on");
  } finally {
    // Cancel a waiting feed before closing stdin, even when an assertion fails.
    exited = true;
    job.state.outranked = false;
    worker.stdin.end();
    await closed;
    output.close();
  }
});

test("census feed: a worker that exits while it waits is never written to", async () => {
  const job = ranked(true);
  const writes: string[] = [];
  let exited = false;
  const queue = createFeed(["a"], { outranked: job.outranked,pause:async()=>{},resume:async()=>{}, everyMs: 10 });
  const pending = queue.feed({ write: (p) => writes.push(p), end: () => writes.push("<end>"), exited: () => exited });
  exited = true;
  job.state.outranked = false;
  await pending;
  assert.deepEqual(writes, []);
  assert.equal(queue.dispatched, 0, "the path stays in the queue for a worker that is alive");
});

test("census feed: two workers waiting for the last path -- one gets it, the other's input closes", async () => {
  const job = ranked(true);
  const one: string[] = [];
  const two: string[] = [];
  const queue = createFeed(["last"], { outranked: job.outranked,pause:async()=>{},resume:async()=>{}, everyMs: 10 });
  const a = queue.feed({ write: (p) => one.push(p), end: () => one.push("<end>"), exited: () => false });
  const b = queue.feed({ write: (p) => two.push(p), end: () => two.push("<end>"), exited: () => false });
  job.state.outranked = false;
  await Promise.all([a, b]);
  assert.deepEqual([...one, ...two].sort(), ["<end>", "last"]);
});

/** Gate tokens a test grants by hand: `held` counts the ones not yet returned. */
function tokens() {
  const asked: string[] = [];
  const waiting: { path: string; grant: () => void }[] = [];
  const state = { held: 0 };
  const token = (path: string, signal: AbortSignal) => new Promise<(() => void) | null>((resolve) => {
    asked.push(path);
    const entry = {
      path,
      grant: () => {
        signal.removeEventListener("abort", abort);
        waiting.splice(waiting.indexOf(entry), 1);
        state.held++;
        let out = true;
        resolve(() => { if (out) { out = false; state.held--; } });
      },
    };
    const abort = () => {
      waiting.splice(waiting.indexOf(entry), 1);
      resolve(null);
    };
    signal.addEventListener("abort", abort, { once: true });
    waiting.push(entry);
  });
  return { token, asked, waiting, state };
}

test("census feed: a case holds its token from its write until its worker returns it", async () => {
  const gate = tokens();
  const writes: [string, () => void][] = [];
  const queue = createFeed(["a"], { token: gate.token, everyMs: 10 });
  const fed = queue.feed({ write: (p, release) => writes.push([p, release]), end: () => {}, exited: () => false });
  await waitFor("a token request", () => gate.waiting.length === 1);
  assert.deepEqual(writes, [], "nothing is written before the token is granted");
  gate.waiting[0].grant();
  await fed;
  assert.deepEqual(writes.map(([p]) => p), ["a"]);
  assert.equal(gate.state.held, 1, "the written case holds its token");
  writes[0][1]();
  writes[0][1]();
  assert.equal(gate.state.held, 0, "the release returns it once, however often it is called");
});

test("census feed: a worker that stops while it waits for a token cancels the wait and gives its path back", async () => {
  const gate = tokens();
  const stopped = new AbortController();
  let exited = false;
  const writes: string[] = [];
  const queue = createFeed(["only"], { token: gate.token, everyMs: 10 });
  const a = queue.feed({ write: (p) => writes.push(`a:${p}`), end: () => writes.push("a:<end>"), exited: () => exited, signal: stopped.signal });
  await waitFor("the reserved path's token request", () => gate.waiting.length === 1);
  exited = true;
  stopped.abort();
  await a;
  assert.deepEqual(gate.waiting, [], "the abandoned wait left the pool's queue");
  assert.equal(queue.dispatched, 0);
  const b = queue.feed({ write: (p) => writes.push(`b:${p}`), end: () => writes.push("b:<end>"), exited: () => false });
  await waitFor("the returned path's token request", () => gate.waiting.length === 1);
  gate.waiting[0].grant();
  await b;
  assert.deepEqual(writes, ["b:only"], "the path went back to the queue, and the next worker took it");
});

test("census feed: a job outranked while a token is awaited turns the case back, with its token", async () => {
  const job = ranked();
  const gate = tokens();
  const writes: string[] = [];
  const queue = createFeed(["a"], { token: gate.token, outranked: job.outranked,pause:async()=>{},resume:async()=>{}, everyMs: 10 });
  const fed = queue.feed({ write: (p) => writes.push(p), end: () => writes.push("<end>"), exited: () => false });
  await waitFor("a token request", () => gate.waiting.length === 1);
  job.state.outranked = true;
  gate.waiting[0].grant();
  await waitFor("the token returned after the second look", () => gate.state.held === 0 && gate.asked.length === 1);
  assert.deepEqual(writes, [], "no case starts while the job is outranked");
  job.state.outranked = false;
  await waitFor("the case asked for a token again", () => gate.waiting.length === 1);
  gate.waiting[0].grant();
  await fed;
  assert.deepEqual(writes, ["a"]);
  assert.deepEqual(gate.asked, ["a", "a"]);
});

test("census feed: no worker asks for a token while no path is left for it", async () => {
  const gate = tokens();
  const ends: string[] = [];
  const queue = createFeed(["one"], { token: gate.token, everyMs: 10 });
  const a = queue.feed({ write: () => {}, end: () => ends.push("a"), exited: () => false });
  const b = queue.feed({ write: () => {}, end: () => ends.push("b"), exited: () => false });
  await waitFor("one request and one closed input", () => gate.waiting.length === 1 && ends.length === 1);
  gate.waiting[0].grant();
  await Promise.all([a, b]);
  assert.deepEqual(gate.asked, ["one"], "the worker with nothing to take never asked");
});

// The real token pool and client under the census feed (issue #821): a worker
// that stops while its token's grant is in flight withdraws its wait, and the
// pool decides which came first. A grant that won comes back to the feed and
// is returned as an offer with its path, so every grant is a dispatch or a
// returned offer; a withdrawal that won is one cancellation. The abort runs
// inside the pool's token.grant observation, after the grant and before its
// 'go' is read, or, in the control, while the request still waits.
for (const when of ["in flight", "waiting"] as const) test(`census feed: a worker stopped while its grant is ${when} leaves every grant dispatched or returned`, async t => {
  const seen = { request: 0, grant: 0, release: 0, cancel: 0 }, open = { n: when === "in flight" ? 1 : 0 };
  const stopped = new AbortController();
  let exited = false;
  const pool = createTokenPool({
    width:1,free: () => open.n - pool.total, claim: () => 0,
    observe: ({ event }) => {
      const key = event.replace(/^token\./, "") as keyof typeof seen;
      if (key in seen) seen[key]++;
      if (event === "token.grant" && seen.grant === 1 && when === "in flight") { exited = true; stopped.abort(); }
    },
  });
  const address = await pool.start();
  assert.ok(address, "the owned token server started");
  t.after(async () => { pool.close(); await pool.closed; });
  const client = tokenClient(address, "census");
  const queue = createFeed(["only"], { token: (path, signal) => client.acquire({ project: path }, signal), everyMs: 10 });
  const first = queue.reserve({ end: () => {}, exited: () => exited, signal: stopped.signal });
  if (when === "waiting") {
    await waitFor("the reserved path's token request", () => pool.waiting.length === 1);
    exited = true; stopped.abort();
  }
  assert.equal(await first, undefined, "the stopped worker is offered nothing");
  await waitFor("the stopped worker's token to settle", () => pool.total === 0 && pool.waiting.length === 0);
  assert.equal(queue.returnedOffers, when === "in flight" ? 1 : 0, JSON.stringify(seen));
  assert.deepEqual(seen, when === "in flight" ? { request: 1, grant: 1, release: 1, cancel: 0 } : { request: 1, grant: 0, release: 0, cancel: 1 });
  // The path went back to the queue either way; the next worker dispatches it.
  open.n = 1;
  const next = await queue.reserve({ end: () => {}, exited: () => false });
  assert.ok(next, "the returned path is offered again");
  assert.equal(next.path, "only");
  next.commit(); await releaseToken(next.release);
  await waitFor("the dispatched token's release", () => pool.total === 0);
  assert.equal(seen.grant, queue.dispatched + queue.returnedOffers, JSON.stringify({ seen, dispatched: queue.dispatched, returned: queue.returnedOffers }));
  assert.equal(seen.release, seen.grant);
});
