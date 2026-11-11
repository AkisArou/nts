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
import { mkdirSync, renameSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createFeed, TemporaryAdmission } from "./admission.ts";
import { captureRunTemporary } from "./run-temporary.ts";
import { createTokenPool } from "./tokenpool.mjs";
import { waitFor } from "./test-wait.ts";
import { testScratch } from "./test-scratch.ts";

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

test("both capture contexts reserve above the temporary floor, and memory is not theirs to admit", t => {
  const { temporary, path } = temporaryFixture(t);
  let freeBytes = 60 * 2 ** 30;
  const options = { path, reservedBytes: 2 ** 30, readFreeBytes: () => freeBytes };
  const gate = new TemporaryAdmission({ ...options, context: { kind: "gate", temporary } });
  const standalone = new TemporaryAdmission({ ...options, context: { kind: "standalone" } });
  assert.equal(gate.check().admitted, true);
  assert.equal(standalone.check().admitted, true);
  assert.equal(gate.check().diskFloorBytes, 40 * 2 ** 30);
  assert.equal(gate.check().requiredFreeBytes, 41 * 2 ** 30);
  assert.equal(standalone.check().diskFloorBytes,gate.check().diskFloorBytes);
  assert.equal(standalone.check().requiredFreeBytes,gate.check().requiredFreeBytes);
  freeBytes = 40.5 * 2 ** 30;
  assert.equal(gate.check().admitted, false, "the image reservation is in addition to the gate temporary floor");
  assert.equal(standalone.check().admitted,false);
  freeBytes = 41 * 2 ** 30;
  assert.equal(gate.check().admitted, true);
  assert.equal(standalone.check().admitted, true);
  assert.equal("availableGiB" in gate.check(), false, "a capture's memory is its job's reservation in the ledger");
});

test("gate policy rejects a replaced registration and outside or escaping capture roots", t => {
  const { run, temporary, path } = temporaryFixture(t);
  const options = { context: { kind: "gate" as const, temporary }, reservedBytes: 2 ** 30, readFreeBytes: () => 60 * 2 ** 30 };
  assert.throws(() => new TemporaryAdmission({ ...options, path: join(run, "outside") }), /outside the registered/);
  mkdirSync(join(run, "outside"));
  symlinkSync(join(run, "outside"), join(temporary.path, "link"));
  assert.throws(() => new TemporaryAdmission({ ...options, path: join(temporary.path, "link", "capture") }), /ancestor escapes/);
  const admitted = new TemporaryAdmission({ ...options, path });
  assert.equal(admitted.check().admitted, true);
  renameSync(temporary.path, join(run, "previous-tmp"));mkdirSync(temporary.path);
  assert.throws(() => admitted.check(), /temporary directory was replaced/);
  assert.throws(() => new TemporaryAdmission({ ...options, path }), /temporary directory was replaced/);
});

test("token pool: a running case finishes through a hold, and the next waits until the hold ends", async () => {
  // run.mjs's `free`, with the slot arithmetic of a 4-slot run, held as a run
  // outranked in the memory ledger holds its tokens.
  const hold = { on: false };
  const pool = createTokenPool({
    free: () => (hold.on ? 0 : 4 - pool.total),
    claim: (_step: string, { waitedS }: { waitedS: number }) => waitedS,
    known: () => true,
  });
  const addr = await pool.start();
  // Held-token state is cleared: inside the gate this test itself runs under a token.
  const env = { ...testEnvironment(), NTS_GATE_TOKENS: addr, NTS_GATE_STEP: "s", NTS_GATE_TOKEN_HELD: "" };
  const run = (script: string, delayStart = false) => {
    const command=join(HERE, "token.sh");
    // The first token request arrives after the old 300 ms assumption.
    const args=delayStart ? ["-c", 'sleep 0.35; exec "$@"', "_", command, "sh", "-c", script] : ["sh", "-c", script];
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
    pool.close();
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
  const queue = createFeed(["a", "b"], { outranked: job.outranked, everyMs: 20 });
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
  const queue = createFeed(["a"], { outranked: job.outranked, everyMs: 10 });
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
  const queue = createFeed(["last"], { outranked: job.outranked, everyMs: 10 });
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
  const queue = createFeed(["a"], { token: gate.token, outranked: job.outranked, everyMs: 10 });
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
