import {testEnvironment,fixtureEnvironment} from "./test-environment.ts";
// The machine's memory ledger: its rule and its queue as functions, then
// `reserve` through real files, the real lock and real owner processes, with
// memory read from NTS_MEMINFO files written here, and admit.ts as a command.
// Nothing here puts the machine under memory pressure: every reading is a file
// the test writes, or a job's use the test sets.
//
//   node --test tooling/gate/memory-ledger.test.ts
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  admissible, cgroupCharge, gib, jobSizing, ledgerStatus, lockLedger, releaseLedgerEntries, noteOver, OOM_SCORE, ownedBy, parseBytes, parseMeminfo, PRIORITIES, reservationPriority, processCharge, processIdentity, processTree, readLedger, reserve,
  type Decision, type LedgerEntry, type Queued, type Reservation, type ReserveOptions, type ReserveRequest,
} from "./memory-ledger.ts";
import { peakReservation, readCostHistory } from "./step-scheduling.ts";
import { spawnTest, waitFor } from "./test-wait.ts";
import { testScratch } from "./test-scratch.ts";
import { ownMemory,withoutHanded } from "./test-memory.ts";

const GiB = 2 ** 30;
const ADMIT = fileURLToPath(new URL("admit.ts", import.meta.url));
const LEDGER = pathToFileURL(fileURLToPath(new URL("memory-ledger.ts", import.meta.url))).href;

test("sizes are written as people write them, in binary units", () => {
  assert.equal(parseBytes("8G"), 8 * GiB);
  assert.equal(parseBytes("8GiB"), 8 * GiB);
  assert.equal(parseBytes("1.5g"), 1.5 * GiB);
  assert.equal(parseBytes("512M"), 512 * 2 ** 20);
  assert.equal(parseBytes("1048576"), 2 ** 20);
  for (const bad of ["", "0", "-1G", "8X", "G", "1e9", "0.0001"]) assert.throws(() => parseBytes(bad), RangeError, bad);
  assert.deepEqual(parseMeminfo("MemTotal:       2048 kB\nMemFree:  1 kB\nMemAvailable:   1024 kB\n"), { availableBytes: 1024 * 1024, totalBytes: 2048 * 1024 });
  assert.equal(parseMeminfo("MemTotal:       2048 kB\n"), null);
});

test("a job is charged what nobody else can have: its file cache and reclaimable slab are MemAvailable's to count", () => {
  const stat = ["anon 3000", "file 1500", "kernel 300", "shmem 100", "active_file 400", "inactive_file 1000", "slab_reclaimable 250", "slab_unreclaimable 50"].join("\n");
  assert.equal(cgroupCharge("4000\n", stat), 4000 - 400 - 1000 - 250);
  assert.throws(() => cgroupCharge("4000\n", "anon 3000\n"), /no active_file/);
  assert.equal(processCharge("Name:\tnode\nRssAnon:\t     100 kB\nRssFile:\t     900 kB\nRssShmem:\t      20 kB\n"), 120 * 1024);
  assert.equal(processCharge("Name:\tkthreadd\nState:\tS (sleeping)\n"), 0, "a kernel thread maps nothing");
});

test("a cgroup is the owner's own only when everything in it is the owner or under it", () => {
  // 10 started 11, which started 12; 20 is a neighbour.
  const table = new Map([[10, { ppid: 1 }], [11, { ppid: 10 }], [12, { ppid: 11 }], [20, { ppid: 1 }]]);
  assert.deepEqual([...processTree(10, table)].sort(), [10, 11, 12]);
  assert.deepEqual([...processTree(99, table)], [], "a process that is gone has no tree");
  assert.equal(ownedBy(10, [10, 11, 12], table), true);
  assert.equal(ownedBy(11, [10, 11, 12], table), false, "its parent is in the cgroup too");
  assert.equal(ownedBy(10, [10, 20], table), false, "a neighbour shares the cgroup");
  assert.equal(ownedBy(10, [10, 98], table), true, "a member that has exited since it was listed holds no process memory");
});

const q = (id: string, gib: number, seq: number, priority: Queued["priority"] = "agent"): Queued => ({ id, bytes: gib * GiB, priority, seq });
const fits = (roomGiB: number, queue: Queued[]) => [...admissible(roomGiB * GiB, queue)].sort();

test("the queue admits its longest prefix that fits, in arrival order within a priority", () => {
  const big = q("big", 12, 1), small = q("small", 1, 2);
  assert.deepEqual(fits(8, [small, big]), [], "the head does not fit, so the small one behind it does not start either");
  assert.deepEqual(fits(12, [small, big]), ["big"], "the head fits, and leaves nothing for the small one");
  assert.deepEqual(fits(13, [small, big]), ["big", "small"], "room for both, so the small one does not wait");
  assert.deepEqual(fits(1, [q("first", 1, 1), q("second", 1, 2)]), ["first"]);
  assert.deepEqual(fits(0, [q("half", 0.5, 1)]), []);
  assert.deepEqual(fits(-3, [small]), [], "less than nothing: pending and the floor exceed what is available");
  assert.deepEqual(fits(1, [q("exact", 1, 1)]), ["exact"], "an exact fit is admitted");
});

test("the landing check outranks agents' work, which outranks the full check, whenever each arrived", () => {
  const full = q("full", 1, 1, "full-check"), agent = q("agent", 2, 5), landing = q("landing", 4, 9, "landing");
  assert.deepEqual(fits(4, [full, agent, landing]), ["landing"]);
  assert.deepEqual(fits(5.9, [full, agent, landing]), ["landing"], "the agent's 2 do not fit in the 1.9 left, and the full check waits behind it");
  assert.deepEqual(fits(6, [full, agent, landing]), ["agent", "landing"]);
  assert.deepEqual(fits(7, [full, agent, landing]), ["agent", "full", "landing"]);
});

type Fixture = {
  dir: string; meminfo: string; env: NodeJS.ProcessEnv;
  /** The fixture's own scheduling history, where its jobs' peaks go. */
  history: string;
  /** Sets MemAvailable (and MemTotal) as the kernel would, in one rename. */
  memory(availableGiB: number, totalGiB?: number): void;
  /** What each admitted job uses, by what it is for; unset is nothing. */
  used: Map<string, number>;
  decisions: Decision[]; lines: string[];
  ask(request: ReserveRequest, extra?: Partial<ReserveOptions>): Promise<Reservation>;
  of(what: string): Decision[];
  stopped(): string | undefined;
};

function fixture(t: TestContext): Fixture {
  const root = testScratch(t, "memory-ledger");
  const env=ownMemory(root);
  const dir = env.NTS_MEMORY_LEDGER, meminfo = env.NTS_MEMINFO;
  const memory = (availableGiB: number, totalGiB = 64) => {
    writeFileSync(`${meminfo}.next`, `MemTotal:       ${totalGiB * 2 ** 20} kB\nMemFree:         1024 kB\nMemAvailable:   ${Math.round(availableGiB * 2 ** 20)} kB\n`);
    renameSync(`${meminfo}.next`, meminfo);
  };
  memory(20);
  const used = new Map<string, number>(), decisions: Decision[] = [], lines: string[] = [], failures: unknown[] = [];
  // Every request still waiting when its test ends is withdrawn.
  const ending = new AbortController();
  t.after(() => ending.abort());
  const ask = (request: ReserveRequest, extra: Partial<ReserveOptions> = {}) => {
    const asked = reserve(request, {
      env, everyMs: 10, signal: ending.signal, report: line => lines.push(line), observe: decision => decisions.push(decision),
      used: (entry: LedgerEntry) => used.get(entry.what) ?? 0, ...extra,
    });
    asked.catch(error => failures.push(error));
    return asked;
  };
  return {
    dir, meminfo, env, history: join(root, "costs", "steps.json"), memory, used, decisions, lines, ask,
    of: what => decisions.filter(decision => decision.what === what),
    stopped: () => failures.length ? String(failures[0]) : undefined,
  };
}

test("joint admission checks and claims the second resource under the ledger lock, only once memory fits", async t => {
  const f = fixture(t);
  f.memory(2.5);
  let attempts = 0;
  const request = f.ask({ bytes: 6 * GiB, what: "joint request" }, { joint: {
    ready: () => { assert.equal(lockLedger(f.dir), null); return true; },
    acquire: () => { assert.equal(lockLedger(f.dir), null); attempts++; return true; },
  } });
  await waitFor("joint memory wait", () => readLedger(f.dir).waiting.length === 1, { stopped: f.stopped });
  assert.equal(attempts, 0, "waiting for memory holds no second resource");
  f.memory(20);
  const held = await request;
  assert.equal(attempts, 1);
  held.release();
});

test("losing a second resource withdraws the memory wait and keeps no promise ahead of ordinary jobs", async t => {
  const f = fixture(t), abort = new AbortController();
  f.memory(2.5);
  let ready = true, checked = false;
  const request = f.ask({ bytes: 6 * GiB, what: "resource waiter" }, { signal: abort.signal, joint: {
    ready: () => { checked = true; return ready; }, acquire: () => false,
  } });
  await waitFor("queued joint request", () => readLedger(f.dir).waiting.length === 1);
  ready = false; checked = false;
  await waitFor("resource deferral", () => checked && readLedger(f.dir).waiting.length === 0);
  const ordinary = await f.ask({ bytes: 128 * 2 ** 20, what: "ordinary job" });
  ordinary.release();
  abort.abort();
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(readLedger(f.dir).admitted.length, 0);
});

test("a lost nonblocking resource claim leaves neither an admission nor a queued memory promise", async t => {
  const f = fixture(t), abort = new AbortController();
  let tried = false;
  const request = f.ask({ bytes: 6 * GiB, what: "lost resource race" }, { signal: abort.signal, joint: {
    ready: () => true, acquire: () => { tried = true; return false; },
  } });
  await waitFor("failed joint claim", () => tried);
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
  abort.abort();
  await assert.rejects(request, { name: "AbortError" });
});

/** A live process to own a reservation, stopped by its own handle. */
function ownerProcess(t: TestContext): ChildProcess & { pid: number } {
  const child = spawn("cat", [], {env:fixtureEnvironment(t), stdio: ["pipe", "ignore", "ignore"] });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  });
  assert.ok(child.pid, "the owner process started");
  return child as ChildProcess & { pid: number };
}

test("a reservation that fits is admitted at once, and its handle releases it", async t => {
  const f = fixture(t);
  const job = await f.ask({ bytes: 4 * GiB, what: "job" });
  assert.equal(job.inherited, false);
  assert.deepEqual(job.env, { NTS_MEMORY_RESERVATION: job.id, NTS_MEMORY_LEDGER: f.dir, NTS_MEMORY_PRIORITY: "agent" });
  const [entry, ...others] = readLedger(f.dir).admitted;
  assert.deepEqual(others, []);
  assert.equal(entry?.id, job.id);
  assert.deepEqual([entry.bytes, entry.what, entry.priority, entry.owner.pid, entry.live], [4 * GiB, "job", "agent", process.pid, true]);
  assert.deepEqual(f.decisions.map(d => [d.admitted, d.roomBytes, d.pendingBytes]), [[true, 18 * GiB, 0]], "20 available less the 2 GiB floor");
  assert.deepEqual(f.lines, [], "a job that did not wait has nothing to say");
  job.release();
  job.release();
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
});

test("what an admitted job has still to take is counted, so two jobs never count on the same free memory", async t => {
  const f = fixture(t);
  const first = await f.ask({ bytes: 10 * GiB, what: "first" });
  const second = f.ask({ bytes: 10 * GiB, what: "second" });
  await waitFor("the second job to wait", () => f.of("second").length >= 2, { stopped: f.stopped });
  assert.match(f.lines[0] ?? "", /^memory: second waits for 10\.0 GiB \(agent\): 20\.0 GiB available, 10\.0 GiB of it promised to running jobs, 2\.0 GiB kept for the system$/);
  assert.equal(readLedger(f.dir).waiting[0]?.what, "second");
  // The first job grows to 7 of its 10: MemAvailable falls by what it took,
  // and what it may still take falls with it, so the room stays 8.
  f.used.set("first", 7 * GiB);
  f.memory(13);
  const seen = f.of("second").length;
  await waitFor("the second job to look again", () => f.of("second").length > seen, { stopped: f.stopped });
  assert.deepEqual([...new Set(f.of("second").slice(seen).map(d => JSON.stringify([d.admitted, d.pendingBytes, d.roomBytes])))], [JSON.stringify([false, 3 * GiB, 8 * GiB])]);
  first.release();
  f.used.delete("first");
  f.memory(20);
  const admitted = await second;
  assert.match(f.lines.at(-1) ?? "", /^memory: second admitted with 10\.0 GiB after \d+ s$/);
  assert.deepEqual(readLedger(f.dir).admitted.map(e => e.what), ["second"]);
  admitted.release();
});

test("a small request never waits behind a big one when both fit, and never delays one that does not", async t => {
  const f = fixture(t);
  const holder = await f.ask({ bytes: 10 * GiB, what: "holder" }); // 20 - 10 - 2: room for 8
  const big = f.ask({ bytes: 12 * GiB, what: "big" });
  await waitFor("the big request to wait", () => f.of("big").length >= 1, { stopped: f.stopped });
  const small = f.ask({ bytes: 1 * GiB, what: "small" });
  await waitFor("the small request to wait three times", () => f.of("small").length >= 3, { stopped: f.stopped });
  assert.ok(f.of("small").every(d => !d.admitted && d.ahead === 1 && d.roomBytes === 8 * GiB), "1 GiB fits in 8, yet it waits behind the 12 that do not");
  assert.ok(f.of("big").every(d => !d.admitted && d.ahead === 0));
  assert.deepEqual(readLedger(f.dir).waiting.map(e => e.what), ["big", "small"]);

  // The holder has used 6 of its 10: room for 14, so both start.
  f.used.set("holder", 6 * GiB);
  const [bigHeld, smallHeld] = await Promise.all([big, small]);
  // Both run, the big job using 11 of its 12 and the small one all of its 1:
  // 8 available, and pending 4 + 1, leaving room for 1. A landing request
  // that arrives after an agent's goes ahead of it.
  f.used.set("big", 11 * GiB);
  f.used.set("small", GiB);
  f.memory(8);
  const agent = f.ask({ bytes: 2 * GiB, what: "agent" });
  await waitFor("the agent's request to wait", () => f.of("agent").length >= 1, { stopped: f.stopped });
  assert.equal(f.of("agent").at(-1)?.roomBytes, GiB);
  // The jobs it outranks promise it only what they use and a margin: the
  // holder 1.5 of its 4, the big job 1, the small one nothing. Room for 3.5,
  // so its 4 waits.
  const landing = f.ask({ bytes: 4 * GiB, what: "landing", priority: "landing" });
  await waitFor("the landing request to wait", () => f.of("landing").length >= 1, { stopped: f.stopped });
  assert.deepEqual([f.of("landing").at(-1)?.ahead, f.of("landing").at(-1)?.roomBytes], [0, 3.5 * GiB], "first in the queue, though it came second");
  // The small job ends: room for 4.5, the landing request's 4, not the agent's 2 as well.
  smallHeld.release();
  f.memory(9);
  const landingHeld = await landing;
  const seen = f.of("agent").length;
  await waitFor("the agent's request to look again", () => f.of("agent").length > seen, { stopped: f.stopped });
  assert.deepEqual([...new Set(f.of("agent").slice(seen).map(d => JSON.stringify([d.admitted, d.ahead, d.roomBytes])))], [JSON.stringify([false, 0, -2 * GiB])],
    "9 available, less 4 + 1 + 4 pending and the floor");
  bigHeld.release();
  f.memory(20);
  (await agent).release();
  for (const reservation of [holder, landingHeld]) reservation.release();
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
});

test("a reservation whose owner has exited is dropped by the next decision, so a crashed holder blocks nobody", async t => {
  const f = fixture(t);
  const child = ownerProcess(t);
  const crashed = await f.ask({ bytes: 10 * GiB, what: "crashed", owner: { pid: child.pid } });
  assert.deepEqual(readLedger(f.dir).admitted.map(e => [e.what, e.owner.pid, e.live]), [["crashed", child.pid, true]]);
  const next = f.ask({ bytes: 10 * GiB, what: "next" });
  await waitFor("the next job to wait behind the live holder", () => f.of("next").length >= 2, { stopped: f.stopped });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const admitted = await next;
  assert.ok(f.lines.includes(`memory: dropped crashed's reservation of 10.0 GiB: its owner, pid ${child.pid}, has exited`), f.lines.join("\n"));
  assert.deepEqual(readLedger(f.dir).admitted.map(e => e.what), ["next"]);
  crashed.release(); // already dropped: releasing it again is harmless
  admitted.release();
});

test("a request whose owner exits while it waits fails, and leaves the queue", async t => {
  const f = fixture(t);
  // Owned by a process of its own: a request from this process's children
  // would draw on a reservation this process held.
  const holder = await f.ask({ bytes: 17 * GiB, what: "holder", owner: { pid: ownerProcess(t).pid } });
  const child = ownerProcess(t);
  const orphan = f.ask({ bytes: 4 * GiB, what: "orphan", owner: { pid: child.pid } });
  await waitFor("the orphan's request to wait", () => f.of("orphan").length >= 1, { stopped: f.stopped });
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  await assert.rejects(orphan, /orphan's owner, pid \d+, exited while it waited/);
  assert.deepEqual(readLedger(f.dir).waiting, []);
  holder.release();
});

test("a request larger than the machine is refused, not queued", async t => {
  const f = fixture(t); // 64 GiB, 2 of them kept for the system
  await assert.rejects(f.ask({ bytes: 63 * GiB, what: "huge" }), /huge asks 63\.0 GiB, which can never fit/);
  await assert.rejects(f.ask({ bytes: 0, what: "nothing" }), RangeError);
  await assert.rejects(f.ask({ bytes: GiB, what: " " }), /names what it is for/);
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
});

test("a reservation grows when the queue admits its growth and shrinks at once, and stays one entry", async t => {
  const f = fixture(t); // 20 available
  const job = await f.ask({ bytes: 4 * GiB, what: "job" });
  await job.grow(6 * GiB); // room for 14: admitted at once
  assert.equal(job.bytes, 10 * GiB);
  const [entry, ...others] = readLedger(f.dir).admitted;
  assert.deepEqual(others, [], "the growth joined the reservation's own entry");
  assert.deepEqual([entry?.id, entry?.bytes, entry?.grows], [job.id, 10 * GiB, null]);
  assert.deepEqual(readLedger(f.dir).waiting, []);
  assert.deepEqual(f.of("job").map(d => [d.admitted, d.grows, d.roomBytes]), [[true, null, 18 * GiB], [true, job.id, 14 * GiB]]);
  assert.deepEqual(f.lines, [], "nothing waited");

  // What it grew by is promised to it: room for 8, so 9 waits until it shrinks.
  const big = f.ask({ bytes: 9 * GiB, what: "big" });
  await waitFor("the big request to wait", () => f.of("big").length >= 2, { stopped: f.stopped });
  assert.ok(f.of("big").every(d => !d.admitted && d.roomBytes === 8 * GiB));
  const shrunk = job.shrink(3 * GiB);
  assert.equal(job.bytes, 7 * GiB, "the holder counts what it gave back at once");
  await shrunk;
  assert.deepEqual(readLedger(f.dir).admitted.map(e => [e.what, e.bytes]), [["job", 7 * GiB]]);
  const held = await big;
  assert.equal(f.of("big").at(-1)?.roomBytes, 11 * GiB);

  await assert.rejects(job.grow(0), RangeError);
  await assert.rejects(job.shrink(7 * GiB), /job holds 7\.0 GiB, so it cannot give back 7\.0 GiB; release it instead/);
  await assert.rejects(job.grow(56 * GiB), /job asks to grow by 56\.0 GiB to 63\.0 GiB, which can never fit/);
  assert.equal(job.bytes, 7 * GiB);
  held.release();
  job.release();
  await job.shrink(GiB); // nothing is held any more, so nothing is given back
  await assert.rejects(job.grow(GiB), /job's reservation has been released, so it cannot grow/);
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
});

test("an admitted job grows before later equal-rank arrivals, which retain their own FIFO order", async t => {
  const f=fixture(t),job=await f.ask({bytes:10*GiB,what:"admitted job"});
  const early=f.ask({bytes:9*GiB,what:"early arrival"});
  await waitFor("early arrival waits",()=>f.of("early arrival").some(d=>!d.admitted),{stopped:f.stopped});
  await job.grow(2*GiB);
  const growth=f.decisions.find(d=>d.grows===job.id)!;
  assert.deepEqual([growth.admitted,growth.ahead,growth.roomBytes],[true,0,8*GiB]);
  const late=f.ask({bytes:GiB,what:"late arrival"});
  await waitFor("late arrival retains FIFO",()=>f.of("late arrival").some(d=>!d.admitted),{stopped:f.stopped});
  assert.ok(f.of("late arrival").every(d=>!d.admitted&&d.ahead===1));
  f.memory(25);
  const [first,second]=await Promise.all([early,late]);
  assert.equal(job.bytes,12*GiB);
  const entries=readLedger(f.dir).admitted;
  assert.ok(entries.find(e=>e.id===first.id)!.seq<entries.find(e=>e.id===second.id)!.seq);
  for(const held of [job,first,second])held.release();
});

test("a growing admitted agent still yields its place and unused promise to a waiting landing", async t => {
  const f=fixture(t),job=await f.ask({bytes:10*GiB,what:"agent job"});
  const blocker=await f.ask({bytes:8*GiB,what:"running landing",priority:"landing"});
  const landing=f.ask({bytes:16*GiB,what:"waiting landing",priority:"landing"});
  await waitFor("higher-rank landing waits",()=>f.of("waiting landing").some(d=>!d.admitted),{stopped:f.stopped});
  const growing=job.grow(2*GiB);growing.catch(()=>{});
  await waitFor("growth follows the landing",()=>f.decisions.some(d=>d.grows===job.id&&!d.admitted),{stopped:f.stopped});
  assert.equal(job.outranked(),true);
  assert.ok(f.decisions.filter(d=>d.grows===job.id).every(d=>!d.admitted&&d.ahead===1));
  blocker.release();const priority=await landing;priority.release();await growing;job.release();
});

test("admitted jobs have distinct live order even when nobody had to queue",async t=>{
  const f=fixture(t),held=[];
  for(const what of ["one","two","three"])held.push(await f.ask({bytes:GiB,what}));
  const order=readLedger(f.dir).admitted.map(e=>e.seq);
  assert.equal(new Set(order).size,3);assert.deepEqual([...order].sort((a,b)=>a-b),[1,2,3]);
  for(const job of held)job.release();
});

test("a growth whose owner exits while it waits fails and leaves the queue, and the reservation it would have grown is dropped", async t => {
  const f = fixture(t);
  const child = ownerProcess(t);
  const job = await f.ask({ bytes: 10 * GiB, what: "job", owner: { pid: child.pid } });
  const growth = job.grow(9 * GiB); // room for 8
  growth.catch(() => {});
  await waitFor("the growth to wait", () => f.decisions.some(d => d.grows === job.id), { stopped: f.stopped });
  const next = f.ask({ bytes: 12 * GiB, what: "next" });
  await waitFor("the next request to wait behind it", () => f.of("next").length >= 2, { stopped: f.stopped });
  assert.ok(f.of("next").every(d => !d.admitted && d.ahead === 1));
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  await assert.rejects(growth, /job's owner, pid \d+, exited while it waited/);
  const admitted = await next;
  assert.ok(f.lines.includes(`memory: dropped job's reservation of 10.0 GiB: its owner, pid ${child.pid}, has exited`), f.lines.join("\n"));
  assert.deepEqual(readLedger(f.dir).admitted.map(e => e.what), ["next"]);
  assert.deepEqual(readLedger(f.dir).waiting, []);
  admitted.release();
});

test("releasing a reservation withdraws its growth, and a growth whose reservation has ended is dropped", async t => {
  const f = fixture(t);
  const job = await f.ask({ bytes: 10 * GiB, what: "job" });
  const growth = job.grow(9 * GiB);
  growth.catch(() => {});
  await waitFor("the growth to wait", () => readLedger(f.dir).waiting.length === 1, { stopped: f.stopped });
  job.release();
  await assert.rejects(growth, /job's reservation was released while it waited to grow/);
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });

  // Its entry gone from under it, as when its owner has exited: the next
  // decision drops the growth. This one waits a minute between its own
  // decisions, so another request's decision is the one that finds it.
  const slow = await f.ask({ bytes: 10 * GiB, what: "slow" }, { everyMs: 60_000 });
  const stop = new AbortController();
  const stranded = slow.grow(9 * GiB, { signal: stop.signal });
  stranded.catch(() => {});
  await waitFor("the growth to wait", () => readLedger(f.dir).waiting.length === 1, { stopped: f.stopped });
  rmSync(join(f.dir, "admitted", `${slow.id}.json`));
  (await f.ask({ bytes: GiB, what: "other" })).release();
  assert.ok(f.lines.includes("memory: dropped slow's request to grow by 9.0 GiB: its reservation has ended"), f.lines.join("\n"));
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
  stop.abort();
  await assert.rejects(stranded, { name: "AbortError" });
});

/**
 * admit.ts under the fixture's ledger and memory reading, and nothing
 * inherited from this process's: inside a gate step, neither the step's
 * reservation nor the run's priority.
 */
function admitEnv(f: Fixture, extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return { ...withoutHanded({ ...testEnvironment(), ...f.env }), ...extra };
}
const admit = (f: Fixture, args: string[], extra?: Readonly<Record<string, string>>) =>
  spawnTest(process.execPath, [ADMIT, ...args], { encoding: "utf8", env: admitEnv(f, extra) }, `admit.ts ${args.join(" ")}`);

test("a child started inside a reservation runs in it at once and asks for nothing", async t => {
  const f = fixture(t);
  const parent = await f.ask({ bytes: 4 * GiB, what: "parent" });
  f.memory(1); // nothing new would fit
  const before = f.decisions.length;
  const child = await f.ask({ bytes: 2 * GiB, what: "child" }, { env: { ...f.env, ...parent.env } });
  assert.deepEqual([child.inherited, child.id, child.env], [true, parent.id, parent.env]);
  assert.equal(child.active(), true);
  assert.equal(f.decisions.length, before, "no decision was made: nothing was asked");
  await child.grow(3 * GiB);
  await child.shrink(GiB);
  assert.equal(child.bytes, 4 * GiB);
  assert.equal(f.decisions.length, before, "nor for its growth: the parent sized its reservation for what runs inside it");
  assert.deepEqual(readLedger(f.dir).admitted.map(e => [e.id, e.bytes]), [[parent.id, 4 * GiB]], "the parent's reservation is as it was");
  child.release();
  assert.deepEqual(readLedger(f.dir).admitted.map(e => e.id), [parent.id], "the child's release leaves its parent's reservation");

  // A real child process: this process's tree holds it, so the reservation counts it.
  const run = admit(f, ["--bytes", "8G", "--what", "inside", "--", "sh", "-c", 'printf %s "$NTS_MEMORY_RESERVATION"'], parent.env);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, parent.id);
  assert.equal(run.stderr, "", "it did not wait");
  assert.deepEqual(readLedger(f.dir).admitted.map(e => e.id), [parent.id], "and it added nothing");

  // Once the parent's reservation has ended, a child asks for its own.
  parent.release();
  assert.deepEqual([parent.active(), child.active()], [false, false]);
  f.memory(20);
  const orphan = await f.ask({ bytes: 2 * GiB, what: "orphan" }, { env: { ...f.env, ...parent.env } });
  assert.deepEqual([orphan.inherited, orphan.active()], [false, true]);
  assert.notEqual(orphan.id, parent.id);
  assert.ok(f.lines.includes(`memory: orphan was started inside reservation ${parent.id}, which has ended; it asks for its own`), f.lines.join("\n"));
  orphan.release();
});

test("a reservation that cannot see a process's memory refuses to have it inside", async t => {
  const f = fixture(t);
  const other = ownerProcess(t);
  const foreign = await f.ask({ bytes: 4 * GiB, what: "foreign", owner: { pid: other.pid } });
  await assert.rejects(f.ask({ bytes: GiB, what: "stray" }, { env: { ...f.env, ...foreign.env } }),
    new RegExp(`stray \\(pid ${process.pid}\\) was started inside foreign's reservation, which does not count its memory`));
  await assert.rejects(f.ask({ bytes: GiB, what: "forged" }, { env: { ...f.env, NTS_MEMORY_RESERVATION: "../admitted/x" } }), /not a reservation id/);
  foreign.release();
});

// A process that takes the ledger's lock if it can, says which, and holds it
// until its stdin closes.
const HOLD = `const [ledger, dir] = process.argv.slice(1);
const { lockLedger } = await import(ledger);
const lock = lockLedger(dir);
process.stdout.write(lock ? "held\\n" : "busy\\n");
if (lock) { process.stdin.on("end", () => { lock.release(); process.stdout.write("released\\n"); }); process.stdin.resume(); }`;

function holder(t: TestContext, dir: string) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", HOLD, LEDGER, dir], {env:fixtureEnvironment(t), stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.setEncoding("utf8").on("data", (data: string) => { out += data; });
  child.stderr.setEncoding("utf8").on("data", (data: string) => { err += data; });
  const closed = once(child, "close");
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; } });
  const ended = () => child.exitCode !== null || child.signalCode !== null ? `exited ${child.exitCode ?? child.signalCode}: ${err}` : undefined;
  return { child, closed, out: () => out, holds: () => waitFor("the lock's holder to take it", () => out === "held\n", { stopped: ended }) };
}

test("decisions are made one at a time: the lock excludes every other process, and ends with its holder", async t => {
  const dir = join(testScratch(t, "memory-ledger-lock"), "ledger");
  const first = holder(t, dir);
  await first.holds();
  assert.equal(lockLedger(dir), null, "this process cannot take it");
  const second = holder(t, dir);
  await second.closed;
  assert.equal(second.out(), "busy\n", "nor can a third");
  first.child.stdin!.end();
  await first.closed;
  assert.equal(first.out(), "held\nreleased\n");

  const mine = lockLedger(dir);
  assert.ok(mine, "released, it is free");
  const third = holder(t, dir);
  await third.closed;
  assert.equal(third.out(), "busy\n", "held by this process, the others are kept out");
  mine.release();

  const killed = holder(t, dir);
  await killed.holds();
  killed.child.kill("SIGKILL");
  await killed.closed;
  const after = lockLedger(dir);
  assert.ok(after, "a holder killed outright leaves no lock behind");
  after.release();
});

test("a reservation is outranked while a live request of higher priority waits, and a job inside it is outranked with it", async t => {
  const f = fixture(t); // 20 available
  const full = await f.ask({ bytes: 10 * GiB, what: "full", priority: "full-check" }); // room for 8 now
  assert.equal(full.outranked(), false);
  // It runs, using 9 of its 10: room for 8 still, for a request of its own
  // priority and for one it yields to, which it promises only 1 more.
  f.used.set("full", 9 * GiB);
  f.memory(11);
  // A landing request whose waiter has exited outranks nobody, though its
  // entry stays until the next decision drops it.
  const dead = { ...processIdentity(process.pid)!, start: "0" };
  const ghost = { version: 2, id: randomUUID(), seq: 1, bytes: GiB, what: "ghost", priority: "landing", owner: dead, waiter: dead,
    measure: { tree: true, cgroup: null }, since: new Date().toISOString(), grows: null };
  mkdirSync(join(f.dir, "waiting"), { recursive: true });
  writeFileSync(join(f.dir, "waiting", `${ghost.id}.json`), JSON.stringify(ghost));
  assert.equal(full.outranked(), false, "only live requests count");
  const peer = f.ask({ bytes: 9 * GiB, what: "peer", priority: "full-check" });
  await waitFor("the peer to wait", () => f.of("peer").length >= 1, { stopped: f.stopped });
  assert.equal(full.outranked(), false, "a request of its own priority waits its turn");
  const agent = f.ask({ bytes: 9 * GiB, what: "agent" });
  await waitFor("the agent's request to wait", () => f.of("agent").length >= 1, { stopped: f.stopped });
  assert.equal(full.outranked(), true, "an agent's request outranks the full check");
  const inner = await f.ask({ bytes: GiB, what: "inner" }, { env: { ...f.env, ...full.env } });
  assert.deepEqual([inner.inherited, inner.outranked()], [true, true], "a job inside the reservation is outranked with it");
  // Using 5, it promises the agent's request 1.25: room for 11.75, and the
  // agent's 9 goes ahead of the peer's.
  f.used.set("full", 5 * GiB);
  f.memory(15);
  const admitted = await agent;
  assert.equal(full.outranked(), false, "only a request of its own priority still waits");
  admitted.release();
  full.release();
  (await peer).release();
  assert.equal(full.outranked(), false);
});

test("an entry an older admit.ts wrote, version 1 without a growth, counts as a reservation of its own", async t => {
  const f = fixture(t); // 20 available
  const owner = ownerProcess(t);
  const who = processIdentity(owner.pid)!;
  const old = { version: 1, id: randomUUID(), seq: 0, bytes: 10 * GiB, what: "older admit.ts", priority: "agent", owner: who, waiter: who,
    measure: { tree: true, cgroup: null }, since: new Date().toISOString() };
  mkdirSync(join(f.dir, "admitted"), { recursive: true });
  writeFileSync(join(f.dir, "admitted", `${old.id}.json`), JSON.stringify(old));
  assert.deepEqual(readLedger(f.dir).admitted.map(e => [e.what, e.version, e.grows, e.live]), [["older admit.ts", 2, null, true]]);
  const next = f.ask({ bytes: 9 * GiB, what: "next" });
  await waitFor("the next request to wait behind it", () => f.of("next").length >= 2, { stopped: f.stopped });
  assert.ok(f.of("next").every(d => !d.admitted && d.pendingBytes === 10 * GiB), "its 10 GiB are promised to it");
  const exited = once(owner, "exit");
  owner.kill("SIGKILL");
  await exited;
  (await next).release();
  assert.ok(f.lines.includes(`memory: dropped older admit.ts's reservation of 10.0 GiB: its owner, pid ${owner.pid}, has exited`), f.lines.join("\n"));
});

test("a shrink writes its entry under the lock: it gives back at once, and the ledger sees it once the lock is free", async t => {
  const f = fixture(t);
  const job = await f.ask({ bytes: 8 * GiB, what: "job" });
  const other = holder(t, f.dir);
  await other.holds();
  const shrunk = job.shrink(4 * GiB);
  assert.equal(job.bytes, 4 * GiB);
  assert.equal(readLedger(f.dir).admitted[0]?.bytes, 8 * GiB, "not written while another process holds the lock");
  other.child.stdin!.end();
  await shrunk;
  assert.equal(readLedger(f.dir).admitted[0]?.bytes, 4 * GiB);
  job.release();
});

test("admit.ts becomes its command: the command's exit status, its signal, and its reservation in the environment", async t => {
  const f = fixture(t);
  const seven = admit(f, ["--bytes", "1M", "--what", "exits 7", "--", "sh", "-c", "exit 7"]);
  assert.deepEqual([seven.status, seven.signal, seven.stderr], [7, null, ""]);
  const killed = admit(f, ["--bytes=1M", "--", "sh", "-c", "kill -TERM $$"]);
  assert.deepEqual([killed.status, killed.signal], [null, "SIGTERM"]);
  const printed = admit(f, ["--bytes", "1M", "--priority", "landing", "--what", "prints", "--", "sh", "-c", 'printf %s "$NTS_MEMORY_RESERVATION"']);
  assert.equal(printed.status, 0, printed.stderr);
  const entry = readLedger(f.dir).admitted.find(e => e.id === printed.stdout);
  assert.deepEqual([entry?.what, entry?.priority, entry?.bytes, entry?.live], ["prints", "landing", 2 ** 20, false], "its owner was the command, which has exited");

  // The next decision drops what the exited commands held.
  const next = await f.ask({ bytes: GiB, what: "next" });
  assert.deepEqual(readLedger(f.dir).admitted.map(e => e.what), ["next"]);
  assert.ok(f.lines.some(line => /^memory: dropped prints's reservation of 1\.0 MiB: its owner, pid \d+, has exited$/.test(line)), f.lines.join("\n"));
  next.release();

  const missing = admit(f, ["--bytes", "1M", "--", "no-such-command-for-admit"]);
  assert.deepEqual([missing.status, missing.stderr], [127, "admit: no-such-command-for-admit: command not found\n"]);
  const usage = admit(f, ["--", "true"]);
  assert.equal(usage.status, 125);
  assert.match(usage.stderr, /^admit: one of --key and --bytes says what to reserve\nusage: node tooling\/gate\/admit\.ts --key/);
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] }, "neither reached the ledger");
});

test("admit.ts waits its turn; a signal while it waits withdraws its request, and a waiter killed outright is dropped", async t => {
  const f = fixture(t);
  // Measured for real, as admit.ts measures it: its owner's tree, far below
  // 10 GiB, so admit.ts sees room for less than 10 (20 - 2 - what the holder
  // has still to take). Its owner is a process of its own, not an ancestor of
  // admit.ts, which would otherwise draw on it.
  const holder = await f.ask({ bytes: 10 * GiB, what: "holder", owner: { pid: ownerProcess(t).pid } }, { used: undefined });
  const start = (what: string) => {
    const child = spawn(process.execPath, [ADMIT, "--bytes", "10G", "--what", what, "--", "true"], { env: admitEnv(f), stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.setEncoding("utf8").on("data", (data: string) => { err += data; });
    const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; } });
    const ended = () => child.exitCode !== null || child.signalCode !== null ? `exited ${child.exitCode ?? child.signalCode}: ${err}` : undefined;
    return { child, closed, waits: () => waitFor(`${what} to wait`, () => err.includes(`memory: ${what} waits for 10.0 GiB (agent)`), { stopped: ended }) };
  };

  const stopped = start("stopped");
  await stopped.waits();
  assert.deepEqual(readLedger(f.dir).waiting.map(e => [e.what, e.live]), [["stopped", true]]);
  stopped.child.kill("SIGTERM");
  assert.deepEqual(await stopped.closed, [null, "SIGTERM"], "it ends by the signal it was sent");
  assert.deepEqual(readLedger(f.dir).waiting, [], "and it withdrew its request first");

  const killed = start("killed");
  await killed.waits();
  killed.child.kill("SIGKILL");
  await killed.closed;
  assert.deepEqual(readLedger(f.dir).waiting.map(e => [e.what, e.live]), [["killed", false]], "nothing withdrew it");

  holder.release();
  const run = admit(f, ["--bytes", "10G", "--what", "after", "--", "true"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /^memory: dropped killed's request for 10\.0 GiB: pid \d+, which waited for it, has exited\n/);
  assert.deepEqual(readLedger(f.dir).waiting, []);
});

// A job in a process of its own, since a job names its reservation in its
// process's environment: it reserves, reserves again from a later call, and
// says what it saw; with `--keep`, it exits without releasing.
const JOB = `const [ledger, keep] = process.argv.slice(1);
const { reserveJob, readLedger } = await import(ledger);
const given = process.env.NTS_MEMORY_LEDGER, listening = process.listenerCount("exit");
const job = await reserveJob({ key: "job", atMostBytes: 2 ** 30, what: "job" }, { report: () => {} });
const named = process.env.NTS_MEMORY_RESERVATION === job.id;
const again = await reserveJob({ key: "a-later-call", atMostBytes: 2 ** 31, what: "a later call of the job" });
const held = readLedger().admitted.map(e => [e.what, e.bytes, e.priority]);
if (keep !== "--keep") job.release();
process.stdout.write(JSON.stringify({ inherited: job.inherited, named, again: [again.inherited, again.id === job.id], held,
  cleared: process.env.NTS_MEMORY_RESERVATION === undefined,
  restored: process.env.NTS_MEMORY_LEDGER === given && process.listenerCount("exit") === listening }));`;

const job = (f: Fixture, extra: Readonly<Record<string, string>> = {}, keep = false) =>
  spawnTest(process.execPath, ["--input-type=module", "-e", JOB, LEDGER, ...(keep ? ["--keep"] : [])], { encoding: "utf8", env: admitEnv(f, extra) }, "a job reserving once");

test("a job reserves once: alone, a reservation of its own that what it starts runs inside; inside one, nothing", async t => {
  const f = fixture(t);
  seedJobs(f, { job: GiB });
  const alone = job(f, { NTS_MEMORY_PRIORITY: "full-check" });
  assert.equal(alone.status, 0, alone.stderr);
  assert.deepEqual(JSON.parse(alone.stdout), { inherited: false, named: true, again: [true, true], held: [["job", GiB, "full-check"]], cleared: true, restored: true },
    "its later call ran inside it, at the priority its environment named, and its release took its name back and left the ledger it was given");
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
  const kept = job(f, {}, true);
  assert.equal(kept.status, 0, kept.stderr);
  assert.deepEqual(readLedger(f.dir).admitted, [], "a job that exits without releasing ends its reservation as it goes");
  // Inside a gate step's reservation (here, this process's), it asks nothing.
  const step = await f.ask({ bytes: 4 * GiB, what: "step" });
  const inside = job(f, step.env);
  assert.equal(inside.status, 0, inside.stderr);
  assert.deepEqual(JSON.parse(inside.stdout), { inherited: true, named: true, again: [true, true], held: [["step", 4 * GiB, "agent"]], cleared: false, restored: true });
  assert.deepEqual(readLedger(f.dir).admitted.map(e => e.id), [step.id], "and the step's reservation is as it was");
  step.release();
});

test("admit.ts --status: the reservations admitted, with what each uses, and the queue in its order", async t => {
  const f = fixture(t); // 20 available
  // Owned by a process of its own, so the agent's job, whose owner is another, draws nothing on it.
  const heldBy = ownerProcess(t);
  const held = await f.ask({ bytes: 12 * GiB, what: "held job", priority: "full-check", owner: { pid: heldBy.pid } }); // room for 6 now, less what it uses
  // It runs, using 11 of its 12: room for 6, for either request, since it
  // promises them only one more whether it yields or not.
  f.used.set("held job", 11 * GiB);
  f.memory(9);
  const owner = ownerProcess(t);
  const agent = f.ask({ bytes: 7 * GiB, what: "agent job", owner: { pid: owner.pid } });
  await waitFor("the agent's request to wait", () => f.of("agent job").length >= 1, { stopped: f.stopped });
  const landing = f.ask({ bytes: 7 * GiB, what: "landing job", priority: "landing" });
  await waitFor("the landing request to wait", () => f.of("landing job").length >= 1, { stopped: f.stopped });
  setCharge(f, 16 * 2 ** 20);
  const json = admit(f, ["--status", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const status = JSON.parse(json.stdout);
  assert.deepEqual([status.version, status.kind, typeof status.at, status.ledger], [1, "memory", "string", f.dir]);
  assert.deepEqual(status.machine, { total_bytes: 64 * GiB, available_bytes: 9 * GiB, floor_bytes: 2 * GiB });
  const [entry, ...others] = status.admitted;
  assert.deepEqual(others, []);
  assert.deepEqual([entry.what, entry.priority, entry.bytes, entry.owner_pid, entry.since, entry.live], ["held job", "full-check", 12 * GiB, heldBy.pid, readLedger(f.dir).admitted[0]!.since, true]);
  assert.ok(Number.isSafeInteger(entry.used_bytes) && entry.used_bytes > 0 && entry.used_bytes < 12 * GiB, "its owned resident observation");
  assert.deepEqual([entry.draws_on, entry.drawn_bytes, entry.lent_bytes], [null, 0, 0]);
  // Its owned observation is used by the status child; the queue's head,
  // the landing request, is promised only that and a margin.
  assert.equal(status.pending_bytes, Math.min(12 * GiB, peakReservation([entry.used_bytes])) - entry.used_bytes);
  assert.equal(status.room_bytes, 9 * GiB - status.pending_bytes - 2 * GiB);
  assert.deepEqual(status.waiting.map((w: { what: string; priority: string; bytes: number; owner_pid: number; grows: null }) => [w.what, w.priority, w.bytes, w.owner_pid, w.grows]),
    [["landing job", "landing", 7 * GiB, process.pid, null], ["agent job", "agent", 7 * GiB, owner.pid, null]], "in the queue's order");
  assert.ok(status.waiting.every((w: { waited_s: number }) => typeof w.waited_s === "number" && w.waited_s >= 0));
  const text = admit(f, ["--status"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^memory ledger .* at \S+\n  machine: 64\.0 GiB, 9\.0 GiB available; /);
  assert.match(text.stdout, /\n  admitted \(1\):\n    full-check +12\.0 GiB, using .*  pid \d+  since \d\d:\d\d:\d\d  held job\n/);
  assert.match(text.stdout, /\n  waiting \(2\):\n     1\. landing +7\.0 GiB  waited \d+ s  pid \d+  landing job\n     2\. agent +7\.0 GiB  waited \d+ s  pid \d+  agent job\n$/);
  // It ends, and what it used is available again: room for both.
  held.release();
  f.memory(20);
  for (const request of [await agent, await landing]) request.release();
});

const MiB = 2 ** 20;
/** A history in which `key` held `bytes` per worker, as 1.25 times it reserves; whole MiB of at least 128. */
const peakFor = (bytes: number) => Math.floor(bytes / 1.25);
function setCharge(f:Fixture,bytes:number):void {
  const file=f.env.NTS_HOST_OBSERVATIONS!,value=JSON.parse(readFileSync(file,"utf8"));
  value.resident={kind:"fixed",defaultBytes:bytes};
  writeFileSync(file,JSON.stringify(value));
}
function seedJobs(f: Fixture, jobs: Record<string, number>): void {
  mkdirSync(join(f.history, ".."), { recursive: true });
  writeFileSync(f.history, JSON.stringify({ version: 3, steps: {}, jobs: Object.fromEntries(Object.entries(jobs).map(([key, bytes]) => [key, { unit: "worker", peaks: [peakFor(bytes)] }])) }) + "\n");
}

// A job of two workers holding 96 MiB as it releases: the last sample of its
// reservation sees them, whatever its sampling thread had seen by then.
const MEASURED_JOB = `const [ledger] = process.argv.slice(1);
const { reserveJob, readLedger } = await import(ledger);
const job = await reserveJob({ key: "held-job", units: 2, what: "measured job" }, { report: () => {} });
const held = {length:96 * 2 ** 20};
const entry = readLedger().admitted.find(e => e.id === job.id);
job.release();
job.release();
process.stdout.write(JSON.stringify({ bytes: entry.bytes, unmeasured: entry.unmeasured ?? [], held: held.length }));`;

test("a job reserves what its earlier runs held per worker, and the peak it held goes to its history as it releases", t => {
  const f = fixture(t);
  setCharge(f,96 * MiB);
  seedJobs(f, { "held-job": GiB });
  const run = spawnTest(process.execPath, ["--input-type=module", "-e", MEASURED_JOB, LEDGER], { encoding: "utf8", env: admitEnv(f) }, "a measured job");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { bytes: 2 * GiB, unmeasured: [], held: 96 * MiB }, "1 GiB a worker, as its history says");
  const kept = readCostHistory(f.history).jobs.get("held-job")!;
  assert.equal(kept.unit, "worker");
  assert.equal(kept.peaks.length, 2, "the seeded peak, and this run's, once however often it was released");
  assert.ok(kept.peaks[1]! >= 48 * MiB, `half of what the job held, per worker: ${kept.peaks[1]}`);
  assert.equal(peakReservation(kept.peaks), GiB, "a smaller run does not shrink the reservation");
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
});

test("an unmeasured job has no forecast; status still names unmeasured steps and fixed reservations that ran over", async t => {
  const f = fixture(t);
  const share = jobSizing({ key: "fresh" }, f.env);
  assert.equal(share.basis, "live");
  assert.equal(share.bytes, 0, "no forecast before the first live sample");
  seedJobs(f, { other: 3 * GiB });
  assert.deepEqual([jobSizing({ key: "fresh", units: 2 }, f.env).bytes, jobSizing({ key: "fresh", units: 2 }, f.env).basis], [0, "live"]);
  assert.equal(jobSizing({ key: "fresh", units: 2, atMostBytes: 4 * GiB }, f.env).bytes, 0, "a cap does not invent a forecast");
  assert.throws(() => jobSizing({ key: "Not A Key" }, f.env), TypeError);
  const held = await f.ask({ bytes: 4 * GiB, what: "fresh job", unmeasured: ["fresh"] });
  await noteOver(f.dir, held.id, "fresh");
  await noteOver(f.dir, held.id, "fresh");
  const [entry] = ledgerStatus({ env: f.env }).admitted;
  assert.deepEqual([entry!.what, entry!.unmeasured, entry!.over], ["fresh job", ["fresh"], ["fresh"]], "each key once");
  const text = admit(f, ["--status"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /fresh job\n      unmeasured \(sized by the largest of its kind, or its share of the machine\): fresh\n      over \(held more than it reserved\): fresh\n/);
  held.release();
});

test("a live job beside a measured job promises only its current margin, which follows both growth and shrink", async t => {
  const f = fixture(t);
  const measured = await f.ask({ bytes: 8 * GiB, what: "measured" });
  f.used.set("measured", 2 * GiB);
  f.used.set("live", GiB); f.memory(17);
  const live = await f.ask({ bytes: 0, what: "live", liveUse: true, unmeasured: ["fresh"] });
  assert.equal(live.bytes, 1.25 * GiB);
  const probe = await f.ask({ bytes: GiB, what: "probe" });
  assert.deepEqual([f.of("probe").at(-1)!.pendingBytes, f.of("probe").at(-1)!.roomBytes], [6.25 * GiB, 8.75 * GiB]);
  probe.release();
  f.used.set("live", 4 * GiB); f.memory(14);
  assert.equal(live.bytes, 5 * GiB);
  const grown = await f.ask({ bytes: GiB, what: "grown probe" });
  assert.deepEqual([f.of("grown probe").at(-1)!.pendingBytes, f.of("grown probe").at(-1)!.roomBytes], [7 * GiB, 5 * GiB]);
  grown.release();
  f.used.set("live", GiB); f.memory(17);
  const shrunk = await f.ask({ bytes: GiB, what: "shrunk probe" });
  assert.equal(f.of("shrunk probe").at(-1)!.pendingBytes, 6.25 * GiB);
  assert.equal(measured.bytes, 8 * GiB, "the measured forecast stays fixed");
  shrunk.release(); live.release(); measured.release();
});

test("a live job waits until its margin fits", async t => {
  const f = fixture(t);
  f.used.set("live waiter", GiB); f.memory(2.1);
  const request = f.ask({ bytes: 0, what: "live waiter", liveUse: true });
  await waitFor("the live margin to wait", () => f.of("live waiter").length > 0, { stopped: f.stopped });
  assert.equal(readLedger(f.dir).admitted.length, 0);
  f.memory(2.5);
  const held = await request;
  assert.equal(held.bytes, 1.25 * GiB);
  held.release();
});

test("a live ancestor has no unused forecast to lend a separate job", async t => {
  const f = fixture(t), child = ownerProcess(t);
  f.used.set("live ancestor", GiB);
  const parent = await f.ask({ bytes: 0, what: "live ancestor", liveUse: true });
  f.used.set("live descendant", GiB); f.memory(2.3);
  const request = f.ask({ bytes: 0, what: "live descendant", liveUse: true, owner: { pid: child.pid } });
  await waitFor("the independent live margin", () => f.of("live descendant").length > 0);
  assert.equal(f.of("live descendant")[0].drawnBytes, 0);
  assert.equal(readLedger(f.dir).admitted.length, 1);
  f.memory(3);
  const held = await request;
  held.release(); parent.release();
});

test("a live child's changing charge draws on its fixed ancestor without stranding unused forecasts", async t => {
  const f = fixture(t), child = ownerProcess(t);
  const parent = await f.ask({ bytes: 8 * GiB, what: "fixed ancestor" });
  f.used.set("fixed ancestor", 2 * GiB);
  f.used.set("live child", GiB); f.memory(17);
  const live = await f.ask({ bytes: 0, what: "live child", liveUse: true, owner: { pid: child.pid } });
  assert.equal(readLedger(f.dir).admitted.find(entry => entry.id === live.id)!.drawsOn, parent.id);
  const initial = await f.ask({ bytes: GiB, what: "initial nested probe" });
  assert.equal(f.of("initial nested probe").at(-1)!.pendingBytes, 5 * GiB);
  initial.release();
  f.used.set("live child", 4 * GiB); f.memory(14);
  const grown = await f.ask({ bytes: GiB, what: "grown nested probe" });
  assert.equal(f.of("grown nested probe").at(-1)!.pendingBytes, 2 * GiB);
  grown.release();
  f.used.set("live child", GiB); f.memory(17);
  const shrunk = await f.ask({ bytes: GiB, what: "shrunk nested probe" });
  assert.equal(f.of("shrunk nested probe").at(-1)!.pendingBytes, 5 * GiB);
  shrunk.release(); live.release(); parent.release();
});

// A command admit.ts becomes: it holds 160 MiB until the ledger's entry for
// it says it is over, which its watcher writes once it has seen them.
const HOLD_UNTIL_OVER = `const { readFileSync, watch } = require("node:fs"), { join } = require("node:path");
const held = {length:160 * 2 ** 20};
const dir = join(process.env.NTS_MEMORY_LEDGER, "admitted"), file = join(dir, process.env.NTS_MEMORY_RESERVATION + ".json");
const over = () => { try { return (JSON.parse(readFileSync(file, "utf8")).over ?? []).includes("admitted-job"); } catch { return false; } };
// Watching before it looks, so a note written between the two is not missed.
const watcher = watch(dir, () => { if (over()) watcher.close(); });
if (over()) watcher.close();
process.on("exit", () => process.stdout.write(String(held.length)));`;

test("admit.ts --key reserves what its key held, and its watcher has the command's peak in the history once the command's output ends", t => {
  const f = fixture(t);
  setCharge(f,160 * MiB);
  seedJobs(f, { "admitted-job": 128 * MiB });
  const run = admit(f, ["--key", "admitted-job", "--what", "admitted job", "--", process.execPath, "-e", HOLD_UNTIL_OVER]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, String(160 * MiB));
  const kept = readCostHistory(f.history).jobs.get("admitted-job")!;
  assert.equal(kept.peaks.length, 2, "the seeded peak, and the command's, written before its output ended");
  assert.ok(kept.peaks[1]! > 128 * MiB, `the command's peak, past what it reserved: ${kept.peaks[1]}`);
  assert.ok(peakReservation(kept.peaks) > 160 * MiB, "its next run reserves by it");
  const refused = admit(f, ["--bytes", "1G", "--workers", "2", "--", "true"]);
  assert.equal(refused.status, 125);
  assert.match(refused.stderr, /--workers and --at-most size a --key/);
  assert.match(admit(f, ["--key", "admitted-job", "--bytes", "1G", "--", "true"]).stderr, /one of --key and --bytes says what to reserve/);
});

test("an unmeasured job ignores other jobs and machine width; a measured reservation keeps its machine cap", t => {
  const f = fixture(t); // 64 GiB, 62 of it the ledger can give
  const wide = jobSizing({ key: "wide", units: 24 }, f.env);
  assert.deepEqual([wide.bytes, wide.basis], [0, "live"], "worker count does not invent a forecast");
  seedJobs(f, { huge: 70 * GiB });
  assert.deepEqual([jobSizing({ key: "fresh" }, f.env).bytes, jobSizing({ key: "fresh" }, f.env).basis], [0, "live"]);
  assert.equal(jobSizing({ key: "huge" }, f.env).bytes, 62 * GiB, "a measured reservation stays capped at all the ledger can give");
});

test("a request that cannot fit now holds nobody behind it, then holds the queue once it could fit, and is admitted when memory frees", async t => {
  const f = fixture(t);
  f.memory(10, 64); // memory nobody reserved holds most of the machine
  const big = f.ask({ bytes: 30 * GiB, what: "big" });
  await waitFor("the big request to wait", () => f.of("big").length >= 1, { stopped: f.stopped });
  assert.equal(f.of("big")[0]!.fits, false);
  assert.match(f.lines.find(line => line.startsWith("memory: big waits")) ?? "", /it holds nobody behind it until memory nobody reserved frees$/);
  const small = await f.ask({ bytes: 4 * GiB, what: "small" });
  assert.deepEqual(readLedger(f.dir).admitted.map(entry => entry.what), ["small"], "the small request passed the big one, which could not fit");
  // Now the big one could fit were every admitted job to end, so it holds the
  // queue again: a second small request waits behind it.
  f.memory(33);
  const seen = f.of("big").length;
  await waitFor("the big request to look again", () => f.of("big").length > seen && f.of("big").at(-1)!.fits, { stopped: f.stopped });
  const later = f.ask({ bytes: 4 * GiB, what: "later small" });
  await waitFor("the later small request to wait behind it", () => f.of("later small").length >= 2, { stopped: f.stopped });
  assert.ok(f.of("later small").every(decision => !decision.admitted && decision.fits), "it fits, and waits behind the big one");
  small.release();
  const admitted = await big;
  assert.deepEqual(readLedger(f.dir).admitted.map(entry => entry.what), ["big"], "admitted once memory freed, ahead of the later small one");
  admitted.release();
  (await later).release();
});

// A job that holds what reserveJob reserved for it, idle, until its standard
// input ends: a build between its phases, or a census pool that has stopped
// starting cases.
const IDLE_JOB = `const [ledger] = process.argv.slice(1);
const { reserveJob } = await import(ledger);
const job = await reserveJob({ key: "idle-job", what: "idle reserveJob job" }, { report: () => {} });
process.stdin.on("data", () => {}).on("end", () => job.release());`;

/** A process of its own that holds a reservation until the test ends its input. */
function idleHolder(t: TestContext, f: Fixture, args: string[], what: string) {
  const child = spawn(process.execPath, args, { env: admitEnv(f), stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  child.stderr!.setEncoding("utf8").on("data", (data: string) => { err += data; });
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; } });
  const ended = () => child.exitCode !== null || child.signalCode !== null ? `${what} exited ${child.exitCode ?? child.signalCode}: ${err}` : undefined;
  return {
    held: () => waitFor(`${what} to be admitted`, () => readLedger(f.dir).admitted.some(entry => entry.what === what), { stopped: ended }),
    end: async () => { child.stdin!.end(); return closed; },
  };
}

test("an idle job of lower priority never holds a request that outranks it, as admit.ts or reserveJob holds it; one of its own priority still waits for all it reserved", async t => {
  const f = fixture(t);
  f.memory(40); // of 64
  seedJobs(f, { "idle-job": 12 * GiB });
  // Each reserves 12 and uses what a process waiting on its input does.
  const fixed = idleHolder(t, f, [ADMIT, "--bytes", "12G", "--what", "idle admit.ts job", "--", "cat"], "idle admit.ts job");
  await fixed.held();
  const sized = idleHolder(t, f, ["--input-type=module", "-e", IDLE_JOB, LEDGER], "idle reserveJob job");
  await sized.held();
  assert.deepEqual(readLedger(f.dir).admitted.map(entry => [entry.what, entry.bytes, entry.priority]).sort(),
    [["idle admit.ts job", 12 * GiB, "agent"], ["idle reserveJob job", 12 * GiB, "agent"]]);
  // Decided by what the jobs use, measured.
  const measured = { used: undefined };
  // An agent's request is promised all 24 they have not used: room for at most 14, so its 15 waits.
  const peer = f.ask({ bytes: 15 * GiB, what: "peer" }, measured);
  await waitFor("the peer to wait", () => f.of("peer").length >= 2, { stopped: f.stopped });
  assert.ok(f.of("peer").every(d => !d.admitted && d.pendingBytes > 23 * GiB), "all they reserved and do not use");
  // A landing request is promised only what they use and a margin: its 30 starts at once.
  const landing = await f.ask({ bytes: 30 * GiB, what: "landing", priority: "landing" }, measured);
  assert.ok(f.of("landing").at(-1)!.pendingBytes < GiB, `far less than the 24 they reserved: ${gib(f.of("landing").at(-1)!.pendingBytes)}`);
  assert.deepEqual(f.lines.filter(line => line.startsWith("memory: landing")), [], "it never waited");
  // Nothing outranks them once it ends: their whole promise counts again, and the peer still waits.
  landing.release();
  const seen = f.of("peer").length;
  await waitFor("the peer to look again", () => f.of("peer").length >= seen + 2, { stopped: f.stopped });
  assert.ok(f.of("peer").slice(seen).every(d => !d.admitted && d.pendingBytes > 23 * GiB));
  assert.deepEqual(await fixed.end(), [0, null]);
  assert.deepEqual(await sized.end(), [0, null]);
  (await peer).release();
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
});

test("a landing's growth is not held by an idle reservation of lower priority: a census pool that stopped starting cases inside admit.ts --bytes 12G (#599)", async t => {
  const f = fixture(t); // 20 available
  const outer = await f.ask({ bytes: 12 * GiB, what: "census under admit.ts" });
  // The pool runs inside it, is outranked once a landing's growth waits, and
  // starts no new case: its cases end, and it holds 1 of the 12.
  const pool = await f.ask({ bytes: 12 * GiB, what: "census pool" }, { env: { ...f.env, ...outer.env } });
  assert.equal(pool.inherited, true);
  f.used.set("census under admit.ts", GiB);
  f.memory(19);
  const landing = await f.ask({ bytes: 4 * GiB, what: "landing run", priority: "landing" });
  // The growth is promised all but what the pool uses and a margin, 0.25:
  // room for 12.75, so its 10 is admitted at once, where all 11 the pool
  // had not used once left it 2.
  await landing.grow(10 * GiB);
  const grown = f.decisions.filter(d => d.grows === landing.id);
  assert.deepEqual(grown.map(d => [d.admitted, d.pendingBytes, d.roomBytes]), [[true, 4.25 * GiB, 12.75 * GiB]]);
  assert.deepEqual(f.lines.filter(line => line.includes("waits to grow")), [], "it never waited");
  // An agent's request, of the outer reservation's own priority, still counts all 11.
  const agent = f.ask({ bytes: 2 * GiB, what: "agent" });
  await waitFor("the agent's request to wait", () => f.of("agent").length >= 1, { stopped: f.stopped });
  assert.equal(f.of("agent").at(-1)?.pendingBytes, 11 * GiB + 14 * GiB);
  for (const reservation of [landing, pool, outer]) reservation.release();
  f.memory(20);
  (await agent).release();
});

test("a request that takes over a reservation ends it as it is admitted, under the same lock, so nothing is admitted between the two", async t => {
  const f = fixture(t); // 20 available
  // A landing's build holds 12: room for 6.
  const build = await f.ask({ bytes: 12 * GiB, what: "build", priority: "landing" });
  // The build is done; an agent's job asks before the gate run does, and waits.
  const agent = f.ask({ bytes: 8 * GiB, what: "agent" });
  await waitFor("the agent's request to wait", () => f.of("agent").length >= 2, { stopped: f.stopped });
  // The gate run's request is promised nothing for the build's reservation, which it takes over: its 14 starts at once.
  const run = await f.ask({ bytes: 14 * GiB, what: "gate run", priority: "landing", replaces: build.id });
  assert.deepEqual([f.of("gate run").at(-1)?.pendingBytes, f.of("gate run").at(-1)?.roomBytes], [0, 18 * GiB]);
  assert.deepEqual(readLedger(f.dir).admitted.map(entry => entry.what), ["gate run"], "the build's reservation ended as the run was admitted");
  assert.deepEqual([build.active(), run.active()], [false, true]);
  assert.ok(f.lines.includes("memory: gate run took over build's reservation of 12.0 GiB"), f.lines.join("\n"));
  // The agent's request never had room: 6 while the build held its 12, 4 now.
  const seen = f.of("agent").length;
  await waitFor("the agent's request to look again", () => f.of("agent").length > seen, { stopped: f.stopped });
  assert.ok(f.of("agent").every(d => !d.admitted));
  assert.equal(f.of("agent").at(-1)?.roomBytes, 4 * GiB);
  build.release(); // taken over already: its release does nothing more
  assert.deepEqual(readLedger(f.dir).admitted.map(entry => entry.what), ["gate run"]);
  // A growth takes nothing over.
  await run.grow(GiB);
  assert.equal(readLedger(f.dir).admitted[0]?.bytes, 15 * GiB);
  run.release();
  (await agent).release();
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
});

test("a request takes over only a reservation that counts its memory; one that has ended leaves nothing to take over", async t => {
  const f = fixture(t);
  const child = ownerProcess(t);
  const other = await f.ask({ bytes: GiB, what: "another job", owner: { pid: child.pid } });
  await assert.rejects(f.ask({ bytes: GiB, what: "thief", replaces: other.id }),
    /^Error: memory: thief \(pid \d+\) would take over another job's reservation, which does not count its memory: it is outside that reservation's process tree$/);
  await assert.rejects(f.ask({ bytes: GiB, what: "garbled", replaces: "not-a-reservation" }), /garbled would take over "not-a-reservation", which is not a reservation id/);
  assert.deepEqual(readLedger(f.dir).admitted.map(entry => entry.what), ["another job"], "neither ended it, nor reached the queue");
  other.release();
  const late = await f.ask({ bytes: GiB, what: "late", replaces: other.id });
  assert.deepEqual(readLedger(f.dir).admitted.map(entry => entry.what), ["late"]);
  late.release();
});

test("a request from inside another job's process tree draws on that job's unused reservation first, asks the queue only for the rest, and the status shows it beneath that job", async t => {
  const f = fixture(t);
  // This process's job holds 8 and uses 2 of them: 6 unused, and room for 10 beside it.
  const holder = await f.ask({ bytes: 8 * GiB, what: "holder" });
  f.used.set("holder", 2 * GiB);
  f.memory(18);
  // Its child's job asks 10: 6 drawn on the holder, 4 asked of the queue.
  const child = ownerProcess(t);
  const drawing = await f.ask({ bytes: 10 * GiB, what: "child job", owner: { pid: child.pid } });
  const decided = f.of("child job").at(-1)!;
  assert.deepEqual([decided.admitted, decided.drawnBytes, decided.pendingBytes, decided.roomBytes], [true, 6 * GiB, 6 * GiB, 10 * GiB]);
  const entry = readLedger(f.dir).admitted.find(one => one.what === "child job")!;
  assert.deepEqual([entry.drawsOn, entry.drawn, entry.bytes], [holder.id, 6 * GiB, 10 * GiB]);
  assert.ok(f.lines.includes("memory: child job drew 6.0 GiB of its 10.0 GiB on holder's unused reservation"), f.lines.join("\n"));
  // The holder lent it 6, which it promises no more: a neighbour is promised the child's 10, not 16.
  const neighbour = f.ask({ bytes: 7 * GiB, what: "neighbour" });
  await waitFor("the neighbour to wait", () => f.of("neighbour").length >= 1, { stopped: f.stopped });
  assert.deepEqual([f.of("neighbour")[0]!.pendingBytes, f.of("neighbour")[0]!.roomBytes], [10 * GiB, 6 * GiB]);
  // The status shows the child's share beneath the holder.
  const json = admit(f, ["--status", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const rows = new Map((JSON.parse(json.stdout).admitted as { what: string; draws_on: string | null; drawn_bytes: number; lent_bytes: number }[]).map(row => [row.what, row]));
  assert.deepEqual([rows.get("child job")?.draws_on, rows.get("child job")?.drawn_bytes, rows.get("holder")?.lent_bytes], [holder.id, 6 * GiB, 6 * GiB]);
  const text = admit(f, ["--status"]);
  assert.match(text.stdout, /\n    agent +8\.0 GiB, using .*  holder\n      agent +10\.0 GiB, using .*  child job\n        drew 6\.0 GiB of it on the reservation above\n/);
  // The child's job ends: the holder's 6 are its own to promise again, and the neighbour's 7 fit beside them.
  drawing.release();
  (await neighbour).release();
  holder.release();
});

test("a request the reservation it draws on covers whole asks the queue nothing, and goes ahead of a queue that does not fit: a holder whose child needs memory never waits for itself", async t => {
  const f = fixture(t); // 20 available
  const holder = await f.ask({ bytes: 16 * GiB, what: "holder" }); // room for 2 beside it
  const big = f.ask({ bytes: 6 * GiB, what: "big" });
  await waitFor("the big request to wait", () => f.of("big").length >= 1, { stopped: f.stopped });
  // The holder's child asks 4 of its 16 unused: admitted at once, though the big request is ahead of it.
  const child = ownerProcess(t);
  const inside = await f.ask({ bytes: 4 * GiB, what: "child", owner: { pid: child.pid } });
  assert.deepEqual([f.of("child").at(-1)!.drawnBytes, f.of("child").at(-1)!.ahead], [4 * GiB, 0]);
  // A growth of it draws on the holder as it did: the 12 left.
  await inside.grow(12 * GiB);
  const drawnNow = () => readLedger(f.dir).admitted.find(entry => entry.what === "child")!;
  assert.deepEqual([drawnNow().bytes, drawnNow().drawn], [16 * GiB, 16 * GiB]);
  // Beyond the holder's forecast, growth still keeps that admitted job's
  // place. Its uncovered 1 GiB fits the 2 GiB beside the holder.
  await inside.grow(GiB);
  const growthOf = () => f.decisions.filter(decision => decision.grows === inside.id);
  assert.deepEqual([drawnNow().bytes,drawnNow().drawn],[17*GiB,16*GiB]);
  assert.deepEqual([growthOf().at(-1)!.admitted,growthOf().at(-1)!.drawnBytes,growthOf().at(-1)!.ahead],[true,0,0]);
  // A shrink returns the uncovered byte forecast first, then borrowed bytes.
  await inside.shrink(8*GiB);
  assert.deepEqual([drawnNow().bytes,drawnNow().drawn],[9*GiB,9*GiB]);
  assert.equal(f.of("big").at(-1)?.admitted,false,"a later request still waits beside the holder");
  inside.release();
  holder.release();
  (await big).release();
});

test("a request can name the reservation it runs inside: one its own process holds, as a gate run that admit.ts became; one that does not count it is passed over", async t => {
  const f = fixture(t); // 20 available
  // admit.ts became this process, holding 12; the gate run it became then asks 4 of its own.
  const holder = await f.ask({ bytes: 12 * GiB, what: "admit.ts job" });
  const run = await f.ask({ bytes: 4 * GiB, what: "gate run", drawsOn: holder.id });
  assert.equal(f.of("gate run").at(-1)?.drawnBytes, 4 * GiB);
  assert.equal(readLedger(f.dir).admitted.find(entry => entry.what === "gate run")?.drawsOn, holder.id);
  // A reservation of a process that is neither this one nor an ancestor does not count this one's memory: nothing is drawn on it.
  const other = await f.ask({ bytes: 2 * GiB, what: "another job", owner: { pid: ownerProcess(t).pid } });
  const alone = await f.ask({ bytes: GiB, what: "a job of its own", drawsOn: other.id });
  assert.deepEqual([f.of("a job of its own").at(-1)?.drawnBytes, readLedger(f.dir).admitted.find(entry => entry.what === "a job of its own")?.drawsOn], [0, undefined]);
  await assert.rejects(f.ask({ bytes: GiB, what: "garbled", drawsOn: "not-a-reservation" }), /garbled would draw on "not-a-reservation", which is not a reservation id/);
  for (const reservation of [alone, other, run, holder]) reservation.release();
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
});

test("a waiter that could not fit were every admitted job to end makes nobody yield; one that could does", async t => {
  const f = fixture(t); // 20 available of 64
  const job = await f.ask({ bytes: 4 * GiB, what: "agent job" });
  const other = await f.ask({ bytes: 8 * GiB, what: "another landing's job", priority: "landing" });
  // Memory nobody reserved holds most of the machine: a landing request of
  // 30 could not fit even were both jobs to end. It waits, and frees nothing
  // a yield could give it.
  f.memory(10);
  const huge = f.ask({ bytes: 30 * GiB, what: "landing", priority: "landing" });
  await waitFor("the landing request to wait", () => f.of("landing").length >= 1, { stopped: f.stopped });
  assert.equal(f.of("landing")[0]!.fits, false);
  assert.equal(readLedger(f.dir).waiting[0]?.fits, false, "its entry says it could not fit");
  assert.equal(job.outranked(), false, "nobody yields to it");
  // Memory frees, but the other landing's job holds 8: it could fit now, and waits, and the agent's job yields to it.
  f.memory(40);
  await waitFor("the landing request to find it could fit", () => readLedger(f.dir).waiting[0]?.fits === true, { stopped: f.stopped });
  assert.equal(job.outranked(), true);
  other.release();
  (await huge).release();
  job.release();
});

test("work is ranked for the OOM killer by priority, a landing's last to go and the full check's first; a score is raised, never lowered", () => {
  assert.ok(OOM_SCORE.landing < OOM_SCORE.agent && OOM_SCORE.agent < OOM_SCORE["full-check"]);
  const inherited = Number(readFileSync("/proc/self/oom_score_adj", "utf8")), ledger = pathToFileURL(fileURLToPath(new URL("./memory-ledger.ts", import.meta.url))).href;
  // A child ranks itself, from `start` when given (a process may raise its own).
  const ranked = (priority: string, start?: number) => Number(spawnSync(process.execPath, ["--input-type=module", "-e",
    `import { readFileSync, writeFileSync } from "node:fs";${start === undefined ? "" : ` writeFileSync("/proc/self/oom_score_adj", "${start}");`}
const { rankForOom } = await import(${JSON.stringify(ledger)}); rankForOom(${JSON.stringify(priority)}); process.stdout.write(readFileSync("/proc/self/oom_score_adj", "utf8"));`],
  {env:testEnvironment(), encoding: "utf8" }).stdout);
  for (const priority of PRIORITIES) assert.equal(ranked(priority), Math.max(inherited, OOM_SCORE[priority]), priority);
  // Above its priority's score already, it stays: an unprivileged process cannot lower its own.
  assert.equal(ranked("landing", 900), 900);
});


test("the 13.6 GiB ancestor replay gives its borrower the agent rank and releases forecasts to a landing",async t=>{
  const f=fixture(t),outer=await f.ask({bytes:Math.round(13.6*GiB),what:"outer agent"});
  const child=await f.ask({bytes:431*2**20,what:"nested full check",priority:"full-check",owner:{pid:ownerProcess(t).pid}});
  f.memory(18.9);
  const outside=f.ask({bytes:10*GiB,what:"outside agent"});
  await waitFor("outside agent waits",()=>f.of("outside agent").some(d=>!d.admitted),{stopped:f.stopped});
  assert.equal(child.outranked(),false);assert.equal(child.env.NTS_MEMORY_PRIORITY,"agent");
  assert.equal(reservationPriority("full-check",f.env,outer.id),"agent");
  assert.equal(ledgerStatus({env:f.env}).admitted.find(e=>e.id===child.id)!.priority,"agent");
  const blocker=await f.ask({bytes:8*GiB,what:"running landing",priority:"landing"});
  const priority=f.ask({bytes:10*GiB,what:"waiting landing",priority:"landing"});
  await waitFor("landing waits",()=>f.of("waiting landing").some(d=>!d.admitted),{stopped:f.stopped});
  assert.equal(child.outranked(),true);assert.equal(outer.outranked(),true);
  assert.ok(ledgerStatus({env:f.env}).pending_bytes<blocker.bytes+2*GiB,"ancestor unused forecast is available to the landing");
  blocker.release();const first=await priority;first.release();child.release();outer.release();(await outside).release();
});

test("the 8.8 GiB ancestor replay admits the net 3.2 GiB growth at the ancestor's place",async t=>{
  const f=fixture(t),outer=await f.ask({bytes:Math.round(8.8*GiB),what:"outer agent"});
  const child=await f.ask({bytes:2*GiB,what:"nested run",owner:{pid:ownerProcess(t).pid}});
  f.memory(18.9);const outside=f.ask({bytes:10*GiB,what:"outside agent"});
  await waitFor("outside waits for 10 GiB",()=>f.of("outside agent").some(d=>!d.admitted),{stopped:f.stopped});
  await child.grow(10*GiB);
  const growth=f.decisions.find(d=>d.grows===child.id)!;
  assert.deepEqual([growth.admitted,growth.ahead,growth.drawnBytes],[true,0,outer.bytes-2*GiB]);
  assert.ok(Math.abs(growth.roomBytes-8.1*GiB)<1024);
  assert.equal(f.of("outside agent").at(-1)!.admitted,false);
  child.release();outer.release();(await outside).release();
});

test("borrowers inherit rank and admission order across multiple ancestors",async t=>{
  const f=fixture(t),outer=await f.ask({bytes:12*GiB,what:"outer agent"});
  const middle=await f.ask({bytes:8*GiB,what:"middle borrower",priority:"full-check",drawsOn:outer.id});
  const inner=await f.ask({bytes:2*GiB,what:"inner borrower",priority:"full-check",drawsOn:middle.id});
  const outside=f.ask({bytes:10*GiB,what:"outside agent"});
  await waitFor("outside waits",()=>f.of("outside agent").some(d=>!d.admitted),{stopped:f.stopped});
  assert.equal(inner.outranked(),false);assert.equal(inner.env.NTS_MEMORY_PRIORITY,"agent");
  await inner.grow(4*GiB);
  assert.deepEqual(f.decisions.filter(d=>d.grows===inner.id).map(d=>[d.admitted,d.ahead]),[[true,0]]);
  for(const held of [inner,middle,outer])held.release();(await outside).release();
});


test("future ledger entries refuse reads, updates and release without changing their bytes",async t=>{
  const f=fixture(t),held=await f.ask({bytes:GiB,what:"future owner"});
  const path=join(f.dir,"admitted",held.id+".json"),original=readFileSync(path,"utf8");
  const future=JSON.stringify({...JSON.parse(original),version:3,extra:"unknown"})+"\n";
  writeFileSync(path,future);
  assert.throws(()=>readLedger(f.dir),/unsupported future state version 3/);
  await assert.rejects(held.noteOver("future-key"),/unsupported future state version 3/);
  held.release();
  assert.match(f.lines.join("\n"),/release cleanup failed.*future state version 3/);
  assert.equal(readFileSync(path,"utf8"),future);
});

test("release under a held directory lock reports and leaves reclamation to the next decision",async t=>{
  const f=fixture(t),child=ownerProcess(t),held=await f.ask({bytes:GiB,what:"blocked release",owner:{pid:child.pid}});
  const path=join(f.dir,"admitted",held.id+".json"),original=readFileSync(path,"utf8");
  const lock=lockLedger(f.dir);assert.ok(lock);
  try{
    releaseLedgerEntries(f.dir,[{id:held.id,state:"admitted"}],"blocked release",line=>f.lines.push(line),()=>lockLedger(f.dir));
    assert.equal(readFileSync(path,"utf8"),original);
    assert.match(f.lines.join("\n"),/blocked release release could not lock.*left for dead-owner reclamation/);
  }finally{lock.release();}
  const exited=once(child,"exit");child.stdin!.end();await exited;
  const next=await f.ask({bytes:GiB,what:"next after failed release"});
  assert.equal(existsSync(path),false);
  assert.match(f.lines.join("\n"),/dropped blocked release's reservation.*has exited/);
  next.release();held.release();
});
