import {testEnvironmentHandoff,fixtureEnvironment} from "./test-environment.ts";
// Joint CPU/memory admission (with-lock.sh): waiting for either holds neither,
// and the payload runs inside the single reservation granted with its mutex.
//
//   node --test tooling/gate/with-lock.test.ts
//
// Every run here has its own memory reading, ledger and history
// (test-memory.ts), and its own lock (NTS_MEASUREMENT_LOCK), so neither the
// machine's queue nor a live measurement decides it. The commands skip the
// quiet-core wait (--no-quiet-wait): what is tested is the order of the
// reservation and the lock, not the CPUs' quiet.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {historyFile,writeCostHistory} from "./step-scheduling.ts";
import { readLedger, reserve } from "./memory-ledger.ts";
import { spawnTest, waitFor } from "./test-wait.ts";
import { newTestScratch } from "./test-scratch.ts";
import { ownMemory } from "./test-memory.ts";
import { gateEnvironment, hostEnvironment } from "./canonical-environment.ts";
import { removable } from "./run-temporary.ts";
import { toolingSliceArgs } from "./tooling-slice.ts";
import { measurementQueue } from "./measurement-admission.ts";
import { contentCacheEnvironment, FIXTURE_ENVIRONMENT } from "./cache-environment.ts";

const WITH_LOCK = fileURLToPath(new URL("./with-lock.sh", import.meta.url));
const ADMIT = fileURLToPath(new URL("./admit.ts", import.meta.url));
const LEDGER = pathToFileURL(fileURLToPath(new URL("./memory-ledger.ts", import.meta.url))).href;
const GiB_KIB = 2 ** 20;

function fixture(t: TestContext, availableKiB = 20 * GiB_KIB) {
  const root = newTestScratch("with-lock"), units: string[] = [];
  const memory = ownMemory(join(root, "memory"), { availableKiB, totalKiB: 32 * GiB_KIB });
  const lock = join(root, "lock.d");
  // A test inside a gate step runs inside the step's reservation: these runs have their own.
  const source = fixtureEnvironment(t);
  const env = gateEnvironment(hostEnvironment(source), { run: join(root, "canonical"), standalone: true,
    owned: { ...contentCacheEnvironment(source), [FIXTURE_ENVIRONMENT]: "1", ...memory, NTS_MEASUREMENT_LOCK: lock } }).env;
  t.after(() => {
    for (const unit of units) spawnSync("systemctl", ["--user", "stop", unit], {env:fixtureEnvironment(t), stdio: "ignore" });
    removable(root); rmSync(root, { recursive: true, force: true });
  });
  const unitArgs = (command: string[], extra: NodeJS.ProcessEnv = {}) => {
    const unit = `nts-test-with-lock-${randomUUID()}`;
    units.push(unit);
    const setenv = Object.entries({ ...env, ...extra }).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([key, value]) => `--setenv=${key}=${value}`);
    return ["--user", ...toolingSliceArgs(), `--unit=${unit}`, "--collect", "--wait", "--pipe", "--quiet",
      "--property=LimitCORE=0", "--property=Nice=19", "--property=CPUAffinity=0-3 6-31", "--property=TimeoutStopSec=5s", "--property=RuntimeMaxSec=300s", ...setenv, ...command];
  };
  const withLock = (args: string[], extra: NodeJS.ProcessEnv = {}) =>
    spawnTest("systemd-run", unitArgs(["sh", WITH_LOCK, ...args], extra), { encoding: "utf8" }, `with-lock.sh ${args.join(" ")}`);
  return { root, memory, lock, env, withLock, unitArgs };
}

test("outside a reservation, a measurement without a key is refused, naming the one way for nts-bench and for an ad-hoc command, and takes no lock", t => {
  const f = fixture(t), ran = join(f.root, "ran");
  const refused = f.withLock(["--wait", "--no-quiet-wait", "sh", "-c", `: > ${JSON.stringify(ran)}`]);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /with-lock: a measurement needs a key for joint memory and CPU admission/);
  assert.match(refused.stderr, /sh tooling\/gate\/with-lock\.sh --wait --key bench-session target\/release\/nts-bench/);
  assert.match(refused.stderr, /sh tooling\/gate\/with-lock\.sh --wait --key perf-<what> taskset -c 4 <command>/);
  assert.deepEqual([existsSync(ran), existsSync(f.lock)], [false, false], "nothing ran, and the lock was never taken");
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] }, "nor was anything asked of the ledger");
  const usage = f.withLock(["--wait", "--key", "perf-nothing"]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: tooling\/gate\/with-lock\.sh \[--wait\] \[--no-quiet-wait\] --key <name> <command>/);
});

test("a fixture, including an empty marker, must name its lock before any admission or payload", t => {
  const f = fixture(t), ran = join(f.root, "ran");
  const before = readdirSync(f.root).sort();
  for (const marker of ["1", ""]) for (const lock of [undefined, ""]) {
    const refused = f.withLock(["--no-quiet-wait", "--key", "perf-private", "touch", ran],
      { [FIXTURE_ENVIRONMENT]: marker, NTS_MEASUREMENT_LOCK: lock });
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /with-lock: fixture environment requires an owned NTS_MEASUREMENT_LOCK/);
    assert.equal(refused.stdout, "");
    assert.deepEqual(readdirSync(f.root).sort(), before, "the refusal creates nothing");
    assert.deepEqual([existsSync(ran), existsSync(f.lock), existsSync(f.memory.NTS_MEMORY_LEDGER)], [false, false, false]);
  }
});

test("a session waits for its memory in the ledger without holding the lock: another measurement takes the lock meanwhile, and the session takes it once admitted", async t => {
  // 2.5 GiB available, 2 kept for the system: not the session's share.
  const f = fixture(t, 2.5 * GiB_KIB), first = join(f.root, "first-ran"), second = join(f.root, "second-ran");
  const waiting = join(f.memory.NTS_MEMORY_LEDGER, "waiting");
  mkdirSync(f.memory.NTS_GATE_COSTS_DIR, { recursive: true });
  assert.equal(writeCostHistory(historyFile(f.memory),{jobs:[{key:"perf-waiting",basis:"job",width:1,peak:2 ** 30}]}),undefined);
  const args = f.unitArgs(["sh", WITH_LOCK, "--wait", "--no-quiet-wait", "--key", "perf-waiting", "sh", "-c", `: > ${JSON.stringify(first)}`]);
  const session = spawn("systemd-run", args, {env:fixtureEnvironment(t), stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  session.stderr!.setEncoding("utf8").on("data", (data: string) => { err += data; });
  const closed = once(session, "close") as Promise<[number | null, NodeJS.Signals | null]>;
  t.after(async () => { if (session.exitCode === null && session.signalCode === null) { spawnSync("systemctl", ["--user", "stop", args.find(arg => arg.startsWith("--unit="))!.slice(7)], {env:fixtureEnvironment(t), stdio: "ignore" }); await closed; } });
  const ended = () => session.exitCode !== null || session.signalCode !== null ? `the session exited ${session.exitCode ?? session.signalCode}: ${err}` : undefined;
  await waitFor("the session to wait in the ledger", () => existsSync(waiting) && readdirSync(waiting).some(name => name.endsWith(".json")), { stopped: ended });
  assert.match(readLedger(f.memory.NTS_MEMORY_LEDGER).waiting[0]?.what ?? "", /^measurement perf-waiting: sh -c /);
  assert.equal(existsSync(f.lock), false, "the session holds no lock while it waits");
  // Another measurement, inside a reservation of its own -- at the landing
  // check's priority, so it goes ahead of the session -- takes the lock without
  // waiting for it, and gives it back.
  mkdirSync(f.memory.NTS_GATE_COSTS_DIR, { recursive: true });
  assert.equal(writeCostHistory(historyFile(f.memory),{jobs:[{key:"perf-landing",basis:"job",width:1,peak:2 ** 20}]}),undefined);
  const other = f.withLock(["--no-quiet-wait", "--key", "perf-landing", "sh", "-c", `: > ${JSON.stringify(second)}`], { NTS_MEMORY_PRIORITY: "landing" });
  assert.equal(other.status, 0, other.stderr);
  assert.deepEqual([existsSync(second), existsSync(first), existsSync(f.lock)], [true, false, false], "it measured while the session still waited");
  // Memory frees: the session is admitted, takes the lock and measures.
  ownMemory(join(f.root, "memory"), { availableKiB: 20 * GiB_KIB, totalKiB: 32 * GiB_KIB });
  assert.deepEqual(await closed, [0, null], err);
  assert.match(err, /memory: measurement perf-waiting: .* admitted with /);
  assert.deepEqual([existsSync(first), existsSync(f.lock)], [true, false]);
});

// A benchmark's cases, as host-columns.ts and the layout tools reserve: each
// asks reserveJob for memory of its own, and says what it was given and what
// the ledger held while it ran.
const CASES = `const [ledger] = process.argv.slice(1);
const { reserveJob, readLedger } = await import(ledger);
const cases = [];
for (const name of ["first case", "second case"]) {
  const job = await reserveJob({ key: "bench-host-columns", what: name }, { report: () => {} });
  cases.push({ inherited: job.inherited, id: job.id });
  job.release();
  await job.closed;
}
const view = readLedger();
process.stdout.write(JSON.stringify({ cases, session: process.env.NTS_MEMORY_RESERVATION, cpus: process.env.NTS_BENCH_CPUS,
  admitted: view.admitted.map(entry => [entry.id, entry.what, entry.priority]), waiting: view.waiting.length }));`;

test("what a session starts runs inside its reservation: its cases ask the ledger for nothing", t => {
  const f = fixture(t);
  const ran = f.withLock(["--wait", "--no-quiet-wait", "--key", "bench-session", process.execPath, "--input-type=module", "-e", CASES, LEDGER]);
  assert.equal(ran.status, 0, ran.stderr);
  const seen = JSON.parse(ran.stdout) as { cases: { inherited: boolean; id: string }[]; session: string; cpus: string; admitted: [string, string, string][]; waiting: number };
  assert.equal(seen.cpus, "4");
  assert.deepEqual(seen.cases, [{ inherited: true, id: seen.session }, { inherited: true, id: seen.session }], "each case ran inside the session's reservation");
  assert.deepEqual([seen.admitted.length, seen.admitted[0]?.[0], seen.waiting], [1, seen.session, 0], "one entry in the ledger, the session's, and no request");
  assert.match(seen.admitted[0]![1], /^measurement bench-session: /);
  assert.equal(seen.admitted[0]![2], "agent", "a hand-run session waits at an agent's priority");
});

test("an outer same-process admission is refused: a measurement must join both queues before it reserves", t => {
  const f = fixture(t);
  const ran = spawnTest("systemd-run", f.unitArgs([process.execPath, ADMIT, "--key", "bench-session", "--", "sh", WITH_LOCK, "--no-quiet-wait", "true"]), { encoding: "utf8" });
  assert.equal(ran.status, 125, ran.stderr);
  assert.match(ran.stderr, /without an outer admit.ts reservation/);
  assert.equal(existsSync(f.lock), false);
});

test("a CPU waiter holds no memory promise, so ordinary work uses all room; cancellation withdraws its ticket", async t => {
  const f = fixture(t), ran = join(f.root, "ran");
  mkdirSync(f.lock); writeFileSync(join(f.lock, "pid"), String(process.pid));
  const args = f.unitArgs(["sh", WITH_LOCK, "--wait", "--no-quiet-wait", "--key", "perf-held", "touch", ran]);
  const child = spawn("systemd-run", args, {env:fixtureEnvironment(t), stdio: "ignore" }), done = once(child, "close");
  const tickets = measurementQueue(f.lock, f.memory.NTS_MEMORY_LEDGER);
  await waitFor("CPU ticket", () => existsSync(tickets) && readdirSync(tickets).some(name => name.endsWith(".json")),
    { stopped: () => child.exitCode !== null ? `unit exited ${child.exitCode}` : undefined });
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
  const ordinary = await reserve({ bytes: 17 * 2 ** 30, what: "ordinary work behind a CPU waiter" }, { env: f.memory });
  ordinary.release();
  assert.equal(existsSync(ran), false);
  spawnSync("systemctl", ["--user", "stop", args.find(arg => arg.startsWith("--unit="))!.slice(7)], {env:fixtureEnvironment(t), stdio: "ignore" });
  await done;
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
  unlinkSync(join(f.lock, "pid")); rmdirSync(f.lock);
  const next = f.withLock(["--no-quiet-wait", "--key", "perf-next", "true"]);
  assert.equal(next.status, 0, next.stderr);
  assert.equal(readdirSync(tickets).filter(name => name.endsWith(".json")).length, 0);
});

test("CPU tickets retain arrival order within ledger priority", async t => {
  const f = fixture(t), order = join(f.root, "order"), children: Promise<unknown>[] = [];
  mkdirSync(f.lock); writeFileSync(join(f.lock, "pid"), String(process.pid));
  const entries = [["agent-first", "agent"], ["nightly", "full-check"], ["agent-second", "agent"], ["landing", "landing"]];
  for (const [name, priority] of entries) {
    const args = f.unitArgs(["sh", WITH_LOCK, "--wait", "--no-quiet-wait", "--key", "perf-order", process.execPath, "-e",
      "require('node:fs').appendFileSync(process.argv[1],process.argv[2]+'\\n')", order, name], { NTS_MEMORY_PRIORITY: priority });
    const child = spawn("systemd-run", args, {env:fixtureEnvironment(t), stdio: "ignore" }); children.push(once(child, "close"));
    const tickets = measurementQueue(f.lock, f.memory.NTS_MEMORY_LEDGER);
    await waitFor(`ticket ${name}`, () => existsSync(tickets) && readdirSync(tickets).filter(name => name.endsWith(".json")).length === children.length,
      { stopped: () => child.exitCode !== null ? `unit exited ${child.exitCode}` : undefined });
  }
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
  unlinkSync(join(f.lock, "pid")); rmdirSync(f.lock);
  for (const child of children) assert.deepEqual(await child, [0, null]);
  assert.deepEqual(readFileSync(order, "utf8").trim().split("\n"), ["landing", "agent-first", "agent-second", "nightly"]);
});

test("a full ledger leaves the CPU mutex available to a landing, then admits the waiting measurement", async t => {
  const f = fixture(t), marker = join(f.root, "holder"), ran = join(f.root, "ran");
  const holderArgs = f.unitArgs([process.execPath, ADMIT, "--bytes", "18G", "--", process.execPath, "-e",
    "const fs=require('node:fs');fs.writeFileSync(process.argv[1],'held');fs.watch(process.argv[1],()=>{});", marker]);
  const holder = spawn("systemd-run", holderArgs, {env:fixtureEnvironment(t), stdio: "ignore" }), holderDone = once(holder, "close");
  await waitFor("full ledger holder", () => existsSync(marker), { stopped: () => holder.exitCode !== null ? `holder ended ${holder.exitCode}` : undefined });
  const args = f.unitArgs(["sh", WITH_LOCK, "--wait", "--no-quiet-wait", "--key", "perf-full", "touch", ran]);
  const child = spawn("systemd-run", args, {env:fixtureEnvironment(t), stdio: "ignore" }), done = once(child, "close");
  await waitFor("memory wait behind full ledger", () => readLedger(f.memory.NTS_MEMORY_LEDGER).waiting.length === 1,
    { stopped: () => child.exitCode !== null ? `measurement ended ${child.exitCode}` : undefined });
  assert.equal(existsSync(f.lock), false);
  const landing = f.withLock(["--no-quiet-wait", "--key", "perf-landing", "true"], { NTS_MEMORY_PRIORITY: "landing" });
  assert.equal(landing.status, 0, landing.stderr);
  assert.equal(existsSync(ran), false);
  assert.equal(existsSync(f.lock), false);
  spawnSync("systemctl", ["--user", "stop", holderArgs.find(arg => arg.startsWith("--unit="))!.slice(7)], {env:fixtureEnvironment(t), stdio: "ignore" });
  await holderDone;
  assert.deepEqual(await done, [0, null]);
  assert.equal(existsSync(ran), true);
});

test("a genuinely nested measurement uses its owned lock and borrows its ancestor's reservation without a second entry", t => {
  const f = fixture(t);
  const body = `const {reserve} = await import(process.argv[1]);
const {spawnSync} = await import('node:child_process');
const held = await reserve({bytes:2**20,what:'parent job'});
const run = spawnSync('sh',[process.argv[2],'--no-quiet-wait',process.execPath,'--input-type=module','-e',process.argv[3],process.argv[1]], {env:{...${testEnvironmentHandoff()},...held.env,NTS_MEASUREMENT_LOCK:process.argv[4]},encoding:'utf8'});
held.release(); process.stdout.write(run.stdout);process.stderr.write(run.stderr);process.exit(run.status??1);`;
  const run = () => spawnTest("systemd-run", f.unitArgs([process.execPath, "--input-type=module", "-e", body, LEDGER, WITH_LOCK, CASES, f.lock]), { encoding: "utf8" });
  mkdirSync(f.lock); writeFileSync(join(f.lock, "pid"), String(process.pid));
  const busy = run();
  assert.equal(busy.status, 75, busy.stderr);
  assert.ok(busy.stderr.includes(`pid ${process.pid} is measuring`), busy.stderr);
  assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), String(process.pid));
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
  unlinkSync(join(f.lock, "pid")); rmdirSync(f.lock);
  const ran = run();
  assert.equal(ran.status, 0, ran.stderr);
  const seen = JSON.parse(ran.stdout);
  assert.deepEqual(seen.admitted.map((entry: string[]) => entry[0]), [seen.session]);
  assert.ok(seen.cases.every((entry: { inherited: boolean; id: string }) => entry.inherited && entry.id === seen.session));
});

test("a busy no-wait call preserves its holder and a dead holder is reclaimed before command failure", t => {
  const f = fixture(t);
  mkdirSync(f.lock); writeFileSync(join(f.lock, "pid"), String(process.pid));
  const busy = f.withLock(["--no-quiet-wait", "--key", "perf-busy", "true"]);
  assert.equal(busy.status, 75, busy.stderr);
  assert.equal(readFileSync(join(f.lock, "pid"), "utf8"), String(process.pid));
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
  writeFileSync(join(f.lock, "pid"), "2147483647");
  const stale = f.withLock(["--no-quiet-wait", "--key", "perf-stale", "sh", "-c", "exit 7"]);
  assert.equal(stale.status, 7, stale.stderr);
  assert.match(stale.stderr, /lock is stale/);
  assert.equal(existsSync(f.lock), false);
});
