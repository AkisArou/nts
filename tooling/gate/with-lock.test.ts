// A measurement reserves its memory before it takes the measurement lock
// (with-lock.sh): a session waiting in the memory ledger never holds CPUs
// 4-5, and what it starts runs inside its one reservation.
//
//   node --test tooling/gate/with-lock.test.ts
//
// Every run here has its own memory reading, ledger and history
// (test-memory.ts), and its own lock (NTS_MEASUREMENT_LOCK), so neither the
// machine's queue nor a live measurement decides it. The commands skip the
// quiet-core wait (--no-quiet-wait): what is tested is the order of the
// reservation and the lock, not the CPUs' quiet.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readLedger, reserve } from "./memory-ledger.ts";
import { spawnTest, waitFor } from "./test-wait.ts";
import { testScratch } from "./test-scratch.ts";
import { ownMemory, withoutHanded } from "./test-memory.ts";

const WITH_LOCK = fileURLToPath(new URL("./with-lock.sh", import.meta.url));
const ADMIT = fileURLToPath(new URL("./admit.ts", import.meta.url));
const LEDGER = pathToFileURL(fileURLToPath(new URL("./memory-ledger.ts", import.meta.url))).href;
const GiB_KIB = 2 ** 20;

function fixture(t: TestContext, availableKiB = 20 * GiB_KIB) {
  const root = testScratch(t, "with-lock");
  const memory = ownMemory(join(root, "memory"), { availableKiB, totalKiB: 32 * GiB_KIB });
  const lock = join(root, "lock.d");
  // A test inside a gate step runs inside the step's reservation: these runs have their own.
  const env = { ...withoutHanded(process.env), ...memory, NTS_MEASUREMENT_LOCK: lock };
  const withLock = (args: string[], extra: NodeJS.ProcessEnv = {}) =>
    spawnTest("sh", [WITH_LOCK, ...args], { encoding: "utf8", env: { ...env, ...extra } }, `with-lock.sh ${args.join(" ")}`);
  return { root, memory, lock, env, withLock };
}

test("outside a reservation, a measurement without a key is refused, naming the one way for nts-bench and for an ad-hoc command, and takes no lock", t => {
  const f = fixture(t), ran = join(f.root, "ran");
  const refused = f.withLock(["--wait", "--no-quiet-wait", "sh", "-c", `: > ${JSON.stringify(ran)}`]);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /^with-lock: a measurement reserves its memory under a key before it takes the measurement lock/);
  assert.match(refused.stderr, /sh tooling\/gate\/with-lock\.sh --wait --key bench-session target\/release\/nts-bench/);
  assert.match(refused.stderr, /sh tooling\/gate\/with-lock\.sh --wait --key perf-<what> taskset -c 4 <command>/);
  assert.deepEqual([existsSync(ran), existsSync(f.lock)], [false, false], "nothing ran, and the lock was never taken");
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] }, "nor was anything asked of the ledger");
  const usage = f.withLock(["--wait", "--key", "perf-nothing"]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^usage: tooling\/gate\/with-lock\.sh \[--wait\] \[--no-quiet-wait\] --key <name> <command>/);
});

test("a session waits for its memory in the ledger without holding the lock: another measurement takes the lock meanwhile, and the session takes it once admitted", async t => {
  // 2.5 GiB available, 2 kept for the system: not the session's share.
  const f = fixture(t, 2.5 * GiB_KIB), first = join(f.root, "first-ran"), second = join(f.root, "second-ran");
  const waiting = join(f.memory.NTS_MEMORY_LEDGER, "waiting");
  const session = spawn("sh", [WITH_LOCK, "--wait", "--no-quiet-wait", "--key", "perf-waiting", "sh", "-c", `: > ${JSON.stringify(first)}`],
    { env: f.env, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  session.stderr!.setEncoding("utf8").on("data", (data: string) => { err += data; });
  const closed = once(session, "close") as Promise<[number | null, NodeJS.Signals | null]>;
  t.after(async () => { if (session.exitCode === null && session.signalCode === null) { session.kill("SIGTERM"); await closed; } });
  const ended = () => session.exitCode !== null || session.signalCode !== null ? `the session exited ${session.exitCode ?? session.signalCode}: ${err}` : undefined;
  await waitFor("the session to wait in the ledger", () => existsSync(waiting) && readdirSync(waiting).some(name => name.endsWith(".json")), { stopped: ended });
  assert.match(readLedger(f.memory.NTS_MEMORY_LEDGER).waiting[0]?.what ?? "", /^measurement perf-waiting: sh -c /);
  assert.equal(existsSync(f.lock), false, "the session holds no lock while it waits");
  // Another measurement, inside a reservation of its own -- at the landing
  // check's priority, so it goes ahead of the session -- takes the lock without
  // waiting for it, and gives it back.
  const held = await reserve({ bytes: 2 ** 20, what: "another measurement", priority: "landing" }, { env: f.memory });
  const other = f.withLock(["--no-quiet-wait", "sh", "-c", `: > ${JSON.stringify(second)}`], held.env);
  held.release();
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

test("the nightly's path is unchanged: inside admit.ts --key bench-session, with-lock.sh needs no key and reserves nothing more", t => {
  const f = fixture(t);
  const ran = spawnTest(process.execPath, [ADMIT, "--key", "bench-session", "--what", "nightly benchmarks", "--", "sh", WITH_LOCK, "--no-quiet-wait",
    process.execPath, "--input-type=module", "-e", CASES, LEDGER], { encoding: "utf8", env: { ...f.env, NTS_MEMORY_PRIORITY: "full-check" } }, "the nightly's session");
  assert.equal(ran.status, 0, ran.stderr);
  const seen = JSON.parse(ran.stdout) as { cases: { inherited: boolean; id: string }[]; session: string; admitted: [string, string, string][]; waiting: number };
  assert.deepEqual(seen.admitted, [[seen.session, "nightly benchmarks", "full-check"]], "admit.ts's reservation, and no other");
  assert.ok(seen.cases.every(one => one.inherited && one.id === seen.session));
  assert.equal(seen.waiting, 0);
});
