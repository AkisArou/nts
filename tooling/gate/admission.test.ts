// Memory admission: the hysteresis itself, then both runners' shapes driven
// through a hold -- the gate's token pool with real token.sh clients, and the
// conformance feed with a real worker process on a pipe.
//
//   node --test tooling/gate/admission.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { Admission, createFeed, memAvailableGB } from "./admission.ts";
import { createTokenPool } from "./tokenpool.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An admission reading `gb.value`, so a test moves memory by assignment. */
function scripted(start: number) {
  const gb = { value: start as number | null };
  const notes: string[] = [];
  return { gb, notes, admission: new Admission({ read: () => gb.value, report: (m) => notes.push(m) }) };
}

test("starts held, resumes at 14, holds again only below 12", () => {
  const { gb, notes, admission } = scripted(13);
  assert.equal(admission.open(), false, "13 at the start is below the starting threshold");
  gb.value = 14;
  assert.equal(admission.open(), true);
  gb.value = 13;
  assert.equal(admission.open(), true, "admitted at 14, it keeps going down to 12");
  gb.value = 12;
  assert.equal(admission.open(), true, "12 itself is not below 12");
  gb.value = 11.9;
  assert.equal(admission.open(), false);
  gb.value = 13;
  assert.equal(admission.open(), false, "held at 11.9, 13 is not enough to resume");
  gb.value = 14;
  assert.equal(admission.open(), true);
  // Waiting at the start, admitted, held, admitted: one report per change, not per check.
  assert.equal(notes.length, 4, notes.join(" | "));
  assert.match(notes[0], /before the first case/);
});

test("a machine that reports no memory admits", () => {
  const { gb, admission } = scripted(null as unknown as number);
  gb.value = null;
  assert.equal(admission.open(), true);
});

test("MemAvailable is read from the file in /proc/meminfo's format", () => {
  const dir = mkdtempSync(join(tmpdir(), "nts-admission-"));
  try {
    const file = join(dir, "meminfo");
    writeFileSync(file, "MemTotal:       32000000 kB\nMemFree:          100000 kB\nMemAvailable:   15728640 kB\n");
    assert.equal(memAvailableGB(file), 15);
    writeFileSync(file, "MemTotal:       32000000 kB\n");
    assert.equal(memAvailableGB(file), null, "a file naming no MemAvailable is no answer, not zero");
    assert.equal(memAvailableGB(join(dir, "missing")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token pool: a running case finishes through a hold, and the next waits for 14 GB", async () => {
  const { gb, admission } = scripted(20);
  // run.mjs's `free`, with the slot arithmetic of a 4-slot run.
  const pool = createTokenPool({
    free: () => (admission.open() ? 4 - pool.total : 0),
    claim: (_step: string, { waitedS }: { waitedS: number }) => waitedS,
    known: () => true,
  });
  const recheck = setInterval(() => pool.grant(), 50);
  const addr = await pool.start();
  // Held-token state is cleared: inside the gate this test itself runs under a token.
  const env = { ...process.env, NTS_GATE_TOKENS: addr, NTS_GATE_STEP: "s", NTS_GATE_TOKEN_HELD: "" };
  const run = (script: string) =>
    new Promise<{ status: number | null; at: number }>((resolve) => {
      const child = spawn(join(HERE, "token.sh"), ["sh", "-c", script], { env, stdio: "ignore" });
      child.on("close", (status) => resolve({ status, at: Date.now() }));
    });
  try {
    const running = run("sleep 1");
    await sleep(300); // it holds its token now
    gb.value = 10; // below 12: no new case may start
    const t0 = Date.now();
    const queued = run("true");
    const first = await running;
    assert.equal(first.status, 0, "the running case was not stopped by the hold");
    await sleep(500);
    assert.equal(pool.total, 0, "nothing was granted below 12 GB");
    gb.value = 13; // held: 13 is not enough
    await sleep(400);
    assert.equal(pool.total, 0, "13 GB does not resume a held pool");
    gb.value = 14;
    const second = await queued;
    assert.equal(second.status, 0);
    assert.ok(second.at - t0 >= 900, `the queued case waited for the resume (${second.at - t0} ms)`);
  } finally {
    clearInterval(recheck);
    pool.close();
  }
});

test("conformance feed: a delayed running case finishes, the next path waits, the last input closes at once", async () => {
  const { gb, admission } = scripted(20);
  // A real pipe, with a response deliberately later than the old 700 ms
  // readiness sleep. Scheduling latency must not decide whether it completed.
  const worker = spawn(
    process.execPath,
    ["-e", `require("readline").createInterface({ input: process.stdin }).on("line", (p) => setTimeout(() => console.log(JSON.stringify({ path: p, at: Date.now() })), 1200));`],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  let exited = false;
  worker.on("exit", () => { exited = true; });
  const closed = once(worker, "close"); // Includes the last stdout row.
  const queue = createFeed(["a", "b"], admission, 20);
  const feed = () => queue.feed({ write: (p) => worker.stdin.write(`${p}\n`), end: () => worker.stdin.end(), exited: () => exited });
  const rows: { path: string; at: number }[] = [];
  const output = createInterface({ input: worker.stdout });
  output.on("line", (line) => {
    rows.push(JSON.parse(line));
    if (rows.length === 1) gb.value = 10; // the hold starts as the first case comes back
    void feed();
  });
  try {
    const firstRow = once(output, "line");
    await feed();
    assert.equal(queue.dispatched, 1);
    await Promise.race([firstRow, closed.then(() => { throw new Error("worker closed before its first row"); })]);
    assert.equal(rows.length, 1, "the first case completed");
    assert.equal(queue.dispatched, 1, "b was not dispatched below 12 GB");
    const resumed = Date.now();
    gb.value = 14;
    assert.equal((await closed)[0], 0, "the worker's input closed after b without waiting on memory");
    assert.deepEqual(rows.map((r) => r.path), ["a", "b"]);
    assert.ok(rows[1].at >= resumed, "b started only after the resume");
  } finally {
    // Cancel a waiting feed before closing stdin, even when an assertion fails.
    exited = true;
    gb.value = 14;
    worker.stdin.end();
    await closed;
    output.close();
  }
});

test("conformance feed: a worker that exits while it waits is never written to", async () => {
  const { gb, admission } = scripted(10);
  const writes: string[] = [];
  let exited = false;
  const queue = createFeed(["a"], admission, 10);
  const pending = queue.feed({ write: (p) => writes.push(p), end: () => writes.push("<end>"), exited: () => exited });
  await sleep(50);
  exited = true;
  gb.value = 20;
  await pending;
  assert.deepEqual(writes, []);
  assert.equal(queue.dispatched, 0, "the path stays in the queue for a worker that is alive");
});

test("conformance feed: two workers waiting for the last path -- one gets it, the other's input closes", async () => {
  const { gb, admission } = scripted(10);
  const one: string[] = [];
  const two: string[] = [];
  const queue = createFeed(["last"], admission, 10);
  const a = queue.feed({ write: (p) => one.push(p), end: () => one.push("<end>"), exited: () => false });
  const b = queue.feed({ write: (p) => two.push(p), end: () => two.push("<end>"), exited: () => false });
  await sleep(30);
  gb.value = 20;
  await Promise.all([a, b]);
  assert.deepEqual([...one, ...two].sort(), ["<end>", "last"]);
});
