// The memory a landing selection holds (selection-memory.ts): its key and
// rank per caller, its place in the ledger's queue among every rank's work,
// and, in a unit of its own, its measured peak charged to its reservation and
// written under its key.
//
//   node --test tooling/landing/selection-memory.test.ts
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeSelection, holdSelection, SELECTION_KEY, SELECTION_RANK, selectionJob } from "./selection-memory.ts";
import { gateEnvironment } from "../gate/canonical-environment.ts";
import { ledgerStatus, readLedger } from "../gate/memory-ledger.ts";
import { PRIORITIES, PRIORITY_ENV } from "../gate/ranks.ts";
import { historyFile, peakReservation, readCostHistory, writeCostHistory } from "../gate/step-scheduling.ts";
import { removable } from "../gate/run-temporary.ts";
import { declareOwnMembers, fixedMembersUnitCommand } from "../gate/test-cgroup-members.ts";
import { assignTestValues, fixtureEnvironment, testEnvironment } from "../gate/test-environment.ts";
import { ownMemory, withoutHanded } from "../gate/test-memory.ts";
import { newTestScratch, testScratch } from "../gate/test-scratch.ts";
import { waitFor } from "../gate/test-wait.ts";
import { toolingSliceArgs, stopToolingSlice } from "../gate/tooling-slice.ts";
import { GateScopes } from "../gate/scopes/step-scope.ts";

const GiB = 2 ** 30, MiB = 2 ** 20;
const SELECTION = new URL("./selection-memory.ts", import.meta.url).href;
const LEDGER = new URL("../gate/memory-ledger.ts", import.meta.url).href;
const rankOf = (priority: string) => (PRIORITIES as readonly string[]).indexOf(priority);

test("each caller's selection reserves under one key, at the rank its code names, against the history of the tree it selects for", () => {
  const shell = { CARGO_TARGET_DIR: "/elsewhere", [PRIORITY_ENV]: "full-check", KEPT: "yes" };
  const service = selectionJob("service", "a".repeat(40), "/landing/target", shell);
  const dry = selectionJob("dry-run", "c".repeat(40), "/tree/target", shell);
  assert.deepEqual([service.request, dry.request], [
    { key: SELECTION_KEY, what: `landing selection of ${"a".repeat(12)}` },
    { key: SELECTION_KEY, what: `landing selection of ${"c".repeat(12)} (--dry-run)` },
  ]);
  assert.deepEqual([service.env[PRIORITY_ENV], dry.env[PRIORITY_ENV]], ["landing", "agent"],
    "the shell's rank never reaches it");
  assert.deepEqual([service.env.CARGO_TARGET_DIR, dry.env.CARGO_TARGET_DIR], ["/landing/target", "/tree/target"]);
  assert.equal(service.env.KEPT, "yes");
  assert.equal(shell[PRIORITY_ENV], "full-check", "the caller's environment is not changed");
  assert.ok(rankOf(SELECTION_RANK.service) < rankOf("culprit-search") && rankOf("culprit-search") < rankOf(SELECTION_RANK["dry-run"]),
    "a landing's selection outranks a culprit search's probe, which outranks an agent's selection");
});

/** A child process that holds a selection (or, given bytes, a plain reservation at `priority`) until its stdin ends. */
const HOLD = `const [selection, ledger, kind, a, b, c] = process.argv.slice(1);
const { once } = await import("node:events");
let held;
if (kind === "selection") { const { holdSelection } = await import(selection); held = await holdSelection(a, b, c, { report: line => process.stdout.write(line + "\\n") }); }
else { const { reserve } = await import(ledger); held = await reserve({ bytes: Number(a), what: b, priority: c }, { report: line => process.stdout.write(line + "\\n") }); }
process.stdout.write("admitted\\n");
process.stdin.resume(); await once(process.stdin, "end");
held.release(); await held.closed;`;

function queueFixture(t: TestContext) {
  const root = testScratch(t, "selection-memory");
  const memory = ownMemory(join(root, "memory"), { availableKiB: 20 * 2 ** 20 });
  const env = { ...withoutHanded({ ...testEnvironment(), ...memory }) };
  declareOwnMembers(env, [process.pid]);
  mkdirSync(memory.NTS_GATE_COSTS_DIR, { recursive: true });
  // Its earlier runs held 6.4 GiB: it reserves 8.
  assert.equal(writeCostHistory(historyFile(env), { jobs: [{ key: SELECTION_KEY, basis: "job", width: 1, peak: Math.floor(8 * GiB / 1.25) }] }), undefined);
  const children: ChildProcess[] = [];
  t.after(async () => { for (const child of children) if (child.exitCode === null && child.signalCode === null) { const ended = once(child, "exit"); child.kill("SIGKILL"); await ended; } });
  const start = (args: string[]) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", HOLD, SELECTION, LEDGER, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    let out = "", err = "";
    child.stdout!.setEncoding("utf8").on("data", data => { out += data; });
    child.stderr!.setEncoding("utf8").on("data", data => { err += data; });
    const ended = once(child, "exit");
    return { get out() { return out; }, stopped: () => child.exitCode !== null ? `exited ${child.exitCode}: ${err}` : undefined,
      end: async () => { child.stdin!.end(); const [code] = await ended; assert.equal(code, 0, err); } };
  };
  return { root, env, memory, start, reading: (availableGiB: number) => ownMemory(join(root, "memory"), { availableKiB: availableGiB * 2 ** 20 }) };
}

test("a landing's selection is admitted ahead of a waiting culprit-search probe and an agent's dry run, which says what it waits for as it starts waiting", async t => {
  const f = queueFixture(t);
  // 20 GiB available, 2 kept: a landing's 15 leaves room for no 8.
  const holder = f.start(["reservation", String(15 * GiB), "holder", "landing"]);
  await waitFor("the holder to be admitted", () => holder.out.includes("admitted"), { stopped: holder.stopped });
  const dry = f.start(["selection", "dry-run", "d".repeat(40), join(f.root, "tree/target")]);
  await waitFor("the dry run to wait", () => readLedger(f.memory.NTS_MEMORY_LEDGER).waiting.length === 1, { stopped: dry.stopped });
  const probe = f.start(["reservation", String(8 * GiB), "culprit-search probe", "culprit-search"]);
  await waitFor("the probe to wait", () => readLedger(f.memory.NTS_MEMORY_LEDGER).waiting.length === 2, { stopped: probe.stopped });
  const service = f.start(["selection", "service", "e".repeat(40), join(f.root, "landing/target")]);
  await waitFor("the service's selection to wait", () => readLedger(f.memory.NTS_MEMORY_LEDGER).waiting.length === 3, { stopped: service.stopped });
  await waitFor("the dry run to say what it waits for", () => /memory: landing selection of d{12} \(--dry-run\) waits for 8\.0 GiB \(agent\)/.test(dry.out), { stopped: dry.stopped });
  assert.deepEqual(ledgerStatus({ env: f.env }).waiting.map(entry => [entry.what, entry.priority, entry.bytes]), [
    [`landing selection of ${"e".repeat(12)}`, "landing", 8 * GiB],
    ["culprit-search probe", "culprit-search", 8 * GiB],
    [`landing selection of ${"d".repeat(12)} (--dry-run)`, "agent", 8 * GiB],
  ], "the queue is in rank order, whatever the arrival order");
  // Room for one 8 GiB request once the holder ends: the landing's selection.
  f.reading(11);
  await holder.end();
  await waitFor("the service's selection to be admitted", () => service.out.includes("admitted"), { stopped: service.stopped });
  assert.ok(!probe.out.includes("admitted") && !dry.out.includes("admitted"), "neither lower rank was admitted before it");
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.map(entry => [entry.what, entry.priority]), [[`landing selection of ${"e".repeat(12)}`, "landing"]]);
  f.reading(20);
  await service.end();
  await waitFor("the probe and the dry run to be admitted", () => probe.out.includes("admitted") && dry.out.includes("admitted"), { stopped: () => probe.stopped() ?? dry.stopped() });
  await probe.end(); await dry.end();
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
});

test("a selection closed after its run took it over, or inside an admit.ts job, leaves nothing behind", async t => {
  const f = queueFixture(t);
  const env = { ...f.env };
  const held = await holdSelection("dry-run", "f".repeat(40), join(f.root, "tree/target"), { env, report: () => {} });
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.map(entry => [entry.what, entry.priority, entry.bytes]),
    [[`landing selection of ${"f".repeat(12)} (--dry-run)`, "agent", 8 * GiB]]);
  await closeSelection(held);
  await closeSelection(held);
  await closeSelection(undefined);
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
  assert.equal(env.NTS_MEMORY_RESERVATION, undefined, "the caller's environment never names it");
});

/**
 * The kernel control: a real selection in a unit of its own, live resident
 * sampling, a selector child that holds 192 MiB. Its reservation is charged
 * for that child while it runs, and the peak goes to the key's history.
 */
test("a selection's peak is charged to its reservation while it runs and written under its key", async t => {
  const root = newTestScratch("selection-memory-live"), units: string[] = [];
  const memory = ownMemory(join(root, "memory"), { availableKiB: 8 * 2 ** 20, totalKiB: 32 * 2 ** 20, resident: { kind: "live" } });
  const env = gateEnvironment(fixtureEnvironment(t, { NTS_MEMORY_RESERVATION: undefined }), { run: join(root, "canonical"), standalone: true, owned: memory }).env;
  const scopes = new GateScopes(env, { rank: SELECTION_RANK["dry-run"] }); assignTestValues(env, { NTS_TOOLING_SLICE: scopes.slice });
  t.after(() => {
    for (const unit of units) spawnSync("systemctl", ["--user", "stop", unit], { env: fixtureEnvironment(t), stdio: "ignore" });
    stopToolingSlice(scopes.slice);
    removable(root); rmSync(root, { recursive: true, force: true });
  });
  const ready = join(root, "ready"), release = join(root, "release");
  writeFileSync(release, "");
  // The selection blocks in a synchronous child as the real one does; its
  // sampler, on a thread of its own, measures it all the same.
  const body = `const {holdSelection,closeSelection}=await import(${JSON.stringify(SELECTION)});
const {readLedger}=await import(${JSON.stringify(LEDGER)});
const {spawnSync}=await import('node:child_process');
const hold=await holdSelection('dry-run','${"a".repeat(40)}',${JSON.stringify(join(root, "tree/target"))},{report:line=>process.stderr.write(line+'\\n')});
const child=spawnSync(process.execPath,['-e',"const fs=require('node:fs'),held=Buffer.alloc(192*2**20,1);fs.writeFileSync(process.argv[1],'ready');const w=fs.watch(process.argv[2],()=>{w.close();process.stdout.write(String(held.length));})",${JSON.stringify(ready)},${JSON.stringify(release)}],{encoding:'utf8'});
const entry=readLedger().admitted.find(row=>row.id===hold.id);
await closeSelection(hold);
process.stdout.write(JSON.stringify({held:Number(child.stdout),status:child.status,what:entry?.what,priority:entry?.priority}));`;
  const unit = `nts-test-selection-memory-${randomUUID()}`; units.push(unit);
  const setenv = Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined).map(([key, value]) => `--setenv=${key}=${value}`);
  const child = spawn("systemd-run", ["--user", ...toolingSliceArgs(env, SELECTION_RANK["dry-run"]), `--unit=${unit}`, "--collect", "--quiet", "--wait", "--pipe",
    "--property=LimitCORE=0", "--property=Nice=19", "--property=CPUAffinity=0-3 6-31", "--property=TimeoutStopSec=5s", "--property=RuntimeMaxSec=200s",
    ...setenv, ...fixedMembersUnitCommand([process.execPath, "--input-type=module", "-e", body])], { env: fixtureEnvironment(t), stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.setEncoding("utf8").on("data", data => { out += data; }); child.stderr.setEncoding("utf8").on("data", data => { err += data; });
  const done = once(child, "close");
  const stopped = () => child.exitCode !== null ? `unit exited ${child.exitCode}: ${err}` : undefined;
  await waitFor("the selector child to hold its memory", () => existsSync(ready), { stopped });
  // While it runs, the admission view charges the selection's reservation for it.
  let charged: ReturnType<typeof ledgerStatus>["admitted"][number] | undefined;
  await waitFor("the selection's reservation to be charged for its child", () => {
    charged = ledgerStatus({ env }).admitted.find(entry => entry.what === `landing selection of ${"a".repeat(12)} (--dry-run)`);
    return (charged?.used_bytes ?? 0) >= 192 * MiB;
  }, { stopped });
  assert.equal(charged?.priority, "agent", "charged at an agent's rank");
  // Unmeasured, it is charged live, and its sampler says in the entry when it sees a new most.
  await waitFor("the selection's sampler to see its child", () => {
    const entry = readLedger(memory.NTS_MEMORY_LEDGER).admitted.find(row => row.what === `landing selection of ${"a".repeat(12)} (--dry-run)`);
    return entry?.liveUse === true && (entry.sampledPeak ?? 0) >= 192 * MiB;
  }, { stopped });
  writeFileSync(release, "go");
  const [code] = await done;
  assert.equal(code, 0, err);
  const result = JSON.parse(out);
  assert.deepEqual([result.held, result.status, result.priority], [192 * MiB, 0, "agent"], err);
  const kept = readCostHistory(historyFile(memory)).jobs.get(SELECTION_KEY);
  assert.ok(kept, `the peak went to ${SELECTION_KEY}'s history: ${err}`);
  assert.equal(kept.basis, "job");
  assert.ok(kept.observations.at(-1)!.peak >= 192 * MiB, `its peak counts its selector child: ${kept.observations.at(-1)!.peak}`);
  assert.ok(peakReservation(kept.observations.map(row => row.peak)) >= 192 * MiB, "and sizes its next run");
  assert.deepEqual(readLedger(memory.NTS_MEMORY_LEDGER), { waiting: [], admitted: [] });
  assert.equal(readFileSync(release, "utf8"), "go");
});
