// The machine's memory ledger: its rule and its queue as functions, then
// `reserve` through real files, the real lock and real owner processes, with
// memory read from NTS_MEMINFO files written here, and admit.ts as a command.
// Nothing here puts the machine under memory pressure: every reading is a file
// the test writes, or a job's use the test sets.
//
//   node --test tooling/gate/memory-ledger.test.ts
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  admissible, cgroupCharge, lockLedger, ownedBy, parseBytes, parseMeminfo, processCharge, processTree, readLedger, reserve,
  type Decision, type LedgerEntry, type Queued, type Reservation, type ReserveOptions, type ReserveRequest,
} from "./memory-ledger.ts";
import { spawnTest, waitFor } from "./test-wait.ts";
import { testScratch } from "./test-scratch.ts";

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
  const dir = join(root, "ledger"), meminfo = join(root, "meminfo");
  const memory = (availableGiB: number, totalGiB = 64) => {
    writeFileSync(`${meminfo}.next`, `MemTotal:       ${totalGiB * 2 ** 20} kB\nMemFree:         1024 kB\nMemAvailable:   ${Math.round(availableGiB * 2 ** 20)} kB\n`);
    renameSync(`${meminfo}.next`, meminfo);
  };
  memory(20);
  const used = new Map<string, number>(), decisions: Decision[] = [], lines: string[] = [], failures: unknown[] = [];
  // Every request still waiting when its test ends is withdrawn.
  const ending = new AbortController();
  t.after(() => ending.abort());
  const env = { NTS_MEMINFO: meminfo, NTS_MEMORY_LEDGER: dir };
  const ask = (request: ReserveRequest, extra: Partial<ReserveOptions> = {}) => {
    const asked = reserve(request, {
      env, everyMs: 10, signal: ending.signal, report: line => lines.push(line), observe: decision => decisions.push(decision),
      used: (entry: LedgerEntry) => used.get(entry.what) ?? 0, ...extra,
    });
    asked.catch(error => failures.push(error));
    return asked;
  };
  return {
    dir, meminfo, env, memory, used, decisions, lines, ask,
    of: what => decisions.filter(decision => decision.what === what),
    stopped: () => failures.length ? String(failures[0]) : undefined,
  };
}

/** A live process to own a reservation, stopped by its own handle. */
function ownerProcess(t: TestContext): ChildProcess & { pid: number } {
  const child = spawn("cat", [], { stdio: ["pipe", "ignore", "ignore"] });
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
  assert.deepEqual(job.env, { NTS_MEMORY_RESERVATION: job.id, NTS_MEMORY_LEDGER: f.dir });
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
  // Pending is now 4 + 12 + 1, leaving room for 1. A landing request that
  // arrives after an agent's goes ahead of it.
  const agent = f.ask({ bytes: 2 * GiB, what: "agent" });
  await waitFor("the agent's request to wait", () => f.of("agent").length >= 1, { stopped: f.stopped });
  const landing = f.ask({ bytes: 2 * GiB, what: "landing", priority: "landing" });
  await waitFor("the landing request to wait", () => f.of("landing").length >= 1, { stopped: f.stopped });
  assert.equal(f.of("landing").at(-1)?.ahead, 0, "first in the queue, though it came second");
  smallHeld.release(); // room for 2: the landing request's, not both
  const landingHeld = await landing;
  const seen = f.of("agent").length;
  await waitFor("the agent's request to look again", () => f.of("agent").length > seen, { stopped: f.stopped });
  assert.deepEqual([...new Set(f.of("agent").slice(seen).map(d => JSON.stringify([d.admitted, d.ahead, d.roomBytes])))], [JSON.stringify([false, 0, 0])]);
  bigHeld.release();
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
  const holder = await f.ask({ bytes: 17 * GiB, what: "holder" });
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

test("a growth waits its turn as a new request would: behind those before it, ahead of those after, and behind the landing check", async t => {
  const f = fixture(t); // 20 available
  const job = await f.ask({ bytes: 10 * GiB, what: "job" }); // room for 8 now
  const early = f.ask({ bytes: 9 * GiB, what: "early" });
  await waitFor("the early request to wait", () => f.of("early").length >= 1, { stopped: f.stopped });
  const growth = job.grow(2 * GiB);
  growth.catch(() => {});
  const growthOf = () => f.decisions.filter(d => d.grows === job.id);
  await waitFor("the growth to wait three times", () => growthOf().length >= 3, { stopped: f.stopped });
  assert.ok(growthOf().every(d => !d.admitted && d.ahead === 1 && d.roomBytes === 8 * GiB), "2 GiB fit in 8, yet the growth waits behind the 9 that do not");
  assert.match(f.lines.find(line => line.includes("waits to grow")) ?? "",
    /^memory: job waits to grow by 2\.0 GiB to 12\.0 GiB \(agent\): 20\.0 GiB available, 10\.0 GiB of it promised to running jobs, 2\.0 GiB kept for the system; 1 ahead of it in the queue$/);
  assert.deepEqual(readLedger(f.dir).waiting.map(e => [e.what, e.grows]), [["early", null], ["job", job.id]]);
  const late = f.ask({ bytes: GiB, what: "late" });
  await waitFor("the late request to wait", () => f.of("late").length >= 2, { stopped: f.stopped });
  assert.ok(f.of("late").every(d => !d.admitted && d.ahead === 2), "behind the growth, which arrived first");
  const landing = await f.ask({ bytes: GiB, what: "landing", priority: "landing" });
  assert.equal(f.of("landing").at(-1)?.ahead, 0, "the landing check goes ahead of the growth");

  // The job has used 3 of its 10: room for 10, which the early 9 takes.
  f.used.set("job", 3 * GiB);
  const earlyHeld = await early;
  const seen = growthOf().length;
  await waitFor("the growth to look again", () => growthOf().length > seen, { stopped: f.stopped });
  assert.ok(growthOf().slice(seen).every(d => !d.admitted), "1 left after the early request's 9");
  earlyHeld.release(); // room for 10: the growth's 2, then the late 1
  const [, lateHeld] = await Promise.all([growth, late]);
  assert.equal(job.bytes, 12 * GiB);
  assert.ok(f.lines.some(line => /^memory: job grew by 2\.0 GiB to 12\.0 GiB after \d+ s$/.test(line)), f.lines.join("\n"));
  assert.deepEqual(readLedger(f.dir).admitted.map(e => [e.what, e.bytes]).sort(), [["job", 12 * GiB], ["landing", GiB], ["late", GiB]]);
  for (const reservation of [job, landing, lateHeld]) reservation.release();
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] });
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

/** admit.ts under the fixture's ledger and memory reading, and nothing inherited from this process's. */
function admitEnv(f: Fixture, extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...f.env };
  delete env.NTS_MEMORY_RESERVATION;
  return { ...env, ...extra };
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
  f.memory(20);
  const orphan = await f.ask({ bytes: 2 * GiB, what: "orphan" }, { env: { ...f.env, ...parent.env } });
  assert.equal(orphan.inherited, false);
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
  const child = spawn(process.execPath, ["--input-type=module", "-e", HOLD, LEDGER, dir], { stdio: ["pipe", "pipe", "pipe"] });
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
  assert.match(usage.stderr, /^admit: --bytes is required\nusage: node tooling\/gate\/admit\.ts --bytes/);
  assert.deepEqual(readLedger(f.dir), { waiting: [], admitted: [] }, "neither reached the ledger");
});

test("admit.ts waits its turn; a signal while it waits withdraws its request, and a waiter killed outright is dropped", async t => {
  const f = fixture(t);
  // Measured for real, as admit.ts measures it: this process's own tree, far
  // below 10 GiB, so admit.ts sees room for less than 10 (20 - 2 - what the
  // holder has still to take).
  const holder = await f.ask({ bytes: 10 * GiB, what: "holder" }, { used: undefined });
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
