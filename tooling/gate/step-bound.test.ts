import {gateFixtureMemory,writeGateFixtureScript} from './fixed-members-fixture.ts';
// The step bound (step-bound.ts), the committed table it reads, and the runner
// that applies it (run.mjs): a step past its bound is stopped through its own
// scope and held, and a step within its bound is untouched.
//
//   node --test tooling/gate/step-bound.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {STEP_CPU_MEASURE, readStepBaseline} from "./step-time.ts";
import { COMMAND_CPU_BUDGET_SECONDS } from "./active-command.ts";
import {gateEnvironment} from './canonical-environment.ts';
import {hostEnvironment} from './host-environment.ts';
import { LANDING_CEILING_FLOOR_S, STEP_BOUND_FLOOR_S, TREE_CHECK_FLOOR_S, ProgressBound, landingCeiling, progressSummary, stepBound, stepBoundReason, stepBoundWait, stepCpuBound, stepCpuBoundReason, unmeasuredSteps } from "./step-bound.ts";
import { instrumentPolicy, publishToolingFailure, readStepInstrument } from "./step-result.ts";
import { HostStateError } from "./host-state.ts";
import { completedHostFault } from "./tooling-test-runner.ts";
import { readRunLifecycle } from "./run-lifecycle.ts";
import { COST_HISTORY_NAME, readCostHistory, usableWidth } from "./step-scheduling.ts";
import { STEPS } from "./step-table.mjs";
import { spawnTest, waitFor } from "./test-wait.ts";
import { newTestScratch } from "./test-scratch.ts";
import {copyModuleClosure} from "./module-closure-fixture.ts";
import { removable } from "./run-temporary.ts";
import { randomUUID } from "node:crypto";
import { hostObservations } from "./host-observations.ts";
import { ownMemory } from "./test-memory.ts";
import { readProcessStat } from "../differential/process-stat/main.ts";
import { cpuList, effectiveCeiling, gateCpus, inheritedCpus } from "./affinity.ts";
import { newToolingSlice, stopToolingSlice, toolingSlice, toolingSliceArgs } from "./tooling-slice.ts";
import type { Priority } from "./ranks.ts";

// These are arithmetic policy vectors, not comparisons of measured CPU.
const baseline = () => readStepBaseline(readFileSync(new URL("./times.tsv", import.meta.url), "utf8"));

test("only a gate-owned admission wait with no executing case suspends a step's execution budget", () => {
  const ready = { elastic:true, held:0, outranked:false, requests:[8,4], freeSlots:1, freeFrontends:1, freeBytes:4, disk:false };
  assert.equal(stepBoundWait(ready), undefined, "one eligible request can execute");
  assert.equal(stepBoundWait({...ready,freeBytes:3}), "memory");
  assert.equal(stepBoundWait({...ready,freeSlots:0}), "slots");
  assert.equal(stepBoundWait({...ready,freeFrontends:0}), "frontends");
  assert.equal(stepBoundWait({...ready,outranked:true,requests:[]}), "priority", "a yielding feed asks for no new token");
  assert.equal(stepBoundWait({...ready,held:1,outranked:true,freeBytes:0}), undefined, "an executing case consumes the budget throughout");
  assert.equal(stepBoundWait({...ready,requests:[],freeBytes:0}), undefined, "a script with no admission request consumes the budget");
  assert.equal(stepBoundWait({...ready,elastic:false,outranked:true}), undefined, "a fixed step's work is not tracked by tokens");
  assert.equal(stepBoundWait({...ready,elastic:false,disk:true}), "disk", "a fixed step's own recorded disk wait");
  assert.equal(stepBoundWait({...ready,requests:[],disk:true}), "disk", "an elastic script holding no token waits for disk");
  assert.equal(stepBoundWait({...ready,held:1,disk:true}), undefined, "a case holding a token consumes the budget through a disk wait");
});

const spent = (state: ReturnType<ProgressBound["observe"]>) => ({ used_s: state.used_s, waited_s: state.waited_s, expired: state.expired });

test("admission waits leave execution time intact, while a landing's wall ceiling always expires", () => {
  const clock = new ProgressBound({ execution_s: 2 }, 0);
  clock.observe(0,"memory");
  assert.equal(clock.observe(10_000,"priority").expired,undefined);
  assert.equal(clock.observe(11_000).expired,undefined);
  assert.equal(clock.observe(12_000).expired,undefined);
  assert.deepEqual(spent(clock.observe(13_000)), {used_s:2,waited_s:{memory:10,priority:1},expired:"execution_s"});
  const landing = new ProgressBound({ execution_s: 2, wall_s: 3 }, 0);
  landing.observe(0,"memory");
  assert.deepEqual(spent(landing.observe(3000,"memory")),{used_s:0,waited_s:{memory:3},expired:"wall_s"});
  assert.equal(new ProgressBound({ execution_s: 2 }, 0).observe(5000).stalled_s, 0, "without CPU samples a budget only spends; nothing is called stalled");
  for (const value of [0, -1, Number.NaN, Infinity]) assert.throws(() => new ProgressBound({ stall_s: value }, 0), /stall_s of .* is not a positive number/);
});

// A run's CPU counters, in seconds: what it ran and how long some of it waited for a CPU.
const cpu = (ran: number, waited = 0) => ({ usageUsec: ran * 1e6, waitingUsec: waited * 1e6 });

test("a run's waits suspend its stall bound, and declared waits spend nothing however little it runs", () => {
  const bound = new ProgressBound({ stall_s: 5 }, 0);
  bound.observe(0, "memory", cpu(0));
  const waited = bound.observe(600_000, "priority", cpu(0.5));
  assert.deepEqual([waited.stalled_s, waited.waited_s, waited.cpu_s, waited.expired], [0, { memory: 600 }, 0.5, undefined]);
  const after = bound.observe(1_200_000, undefined, cpu(0.5));
  assert.deepEqual([after.stalled_s, after.waited_s, after.expired], [0, { memory: 600, priority: 600 }, undefined]);
});

test("CPU progress feeds a run's bound: what it runs, and what higher ranks take from it, is not a stall", () => {
  const busy = new ProgressBound({ stall_s: 5 }, 0);
  busy.observe(0, undefined, cpu(0));
  const working = busy.observe(100_000, undefined, cpu(2400));
  assert.deepEqual([working.used_s, working.stalled_s, working.cpu_s, working.expired], [100, 0, 2400, undefined], "a run using the machine");
  const outranked = new ProgressBound({ stall_s: 5 }, 0);
  outranked.observe(0, undefined, cpu(0));
  // #823's held run: about 1% of a CPU, its tasks runnable the rest of the time.
  const slowed = outranked.observe(1_000_000, undefined, cpu(10, 990));
  assert.deepEqual([slowed.cpu_lost_s, slowed.used_s, slowed.stalled_s, slowed.expired], [990, 10, 0, undefined]);
  assert.equal(new ProgressBound({ wall_s: 5 }, 0).observe(1_000_000).expired, "wall_s", "the counterfactual: a wall clock holds that run");
});

test("a run that neither runs nor waits stalls and is held at its stall bound, and a spinning run at its CPU bound", () => {
  const sleeping = new ProgressBound({ stall_s: 5, cpu_s: 100 }, 0);
  sleeping.observe(0, undefined, cpu(0));
  // A hung runner still samples itself: about 1% of a CPU.
  assert.equal(sleeping.observe(4000, undefined, cpu(0.04)).expired, undefined);
  const held = sleeping.observe(6000, undefined, cpu(0.06));
  assert.equal(held.expired, "stall_s");
  assert.ok(Math.abs(held.stalled_s - 5.94) < 1e-9, String(held.stalled_s));
  assert.equal(progressSummary(held), "in 6 s it ran 0.1 cpu-s, lost 0 s to higher-ranked CPU work and stalled 6 s");
  const spinning = new ProgressBound({ stall_s: 5, cpu_s: 100 }, 0);
  spinning.observe(0, undefined, cpu(0));
  const spun = spinning.observe(100_000, "memory", cpu(100));
  assert.deepEqual([spun.expired, spun.stalled_s], ["cpu_s", 0]);
  assert.equal(progressSummary(spinning.observe(101_000, undefined, cpu(101))), "in 101 s it ran 101.0 cpu-s, lost 0 s to higher-ranked CPU work, waited 1 s for memory and stalled 0 s");
});

test("used time outside any step, with no step event, spends a run's lifecycle bound; a step event resets it, and waits and lost CPU spend nothing", () => {
  const steps = (events: number, running: number) => ({ events, running });
  const bound = new ProgressBound({ stall_s: 100, lifecycle_s: 5 }, 0);
  bound.observe(0, undefined, cpu(0), steps(0, 0));
  // Setup and the release build run before any step: they count.
  assert.equal(bound.observe(3000, undefined, cpu(3), steps(1, 1)).outside_s, 0, "the first step started");
  assert.equal(bound.observe(60_000, undefined, cpu(60), steps(1, 1)).outside_s, 0, "a running step is the step bound's to bound");
  assert.equal(bound.observe(61_000, "memory", cpu(61), steps(2, 0)).outside_s, 0, "it finished");
  assert.equal(bound.observe(100_000, undefined, cpu(61), steps(2, 0)).outside_s, 0, "the run's own wait spends nothing");
  // After the last step, the runner spins: every second is CPU, and no step moves.
  const spun = bound.observe(105_000, undefined, cpu(66), steps(2, 0));
  assert.deepEqual([spun.expired, spun.outside_s, spun.stalled_s], ["lifecycle_s", 5, 0]);
  // A release build outranked for the CPUs, before its first step: what higher ranks take spends nothing.
  const build = new ProgressBound({ stall_s: 100, lifecycle_s: 10 }, 0);
  build.observe(0, undefined, cpu(0), steps(0, 0));
  const slowed = build.observe(600_000, undefined, cpu(6, 594), steps(0, 0));
  assert.deepEqual([slowed.expired, slowed.outside_s, slowed.cpu_lost_s], [undefined, 6, 594]);
  assert.equal(new ProgressBound({ execution_s: 2 }, 0).observe(5000).outside_s, 0, "without a lifecycle nothing is outside a step");
});

test("a sampled bound divides the undeclared time between samples at the next one, while declared waits stay exact", () => {
  // A step's clock: CPU read on its tick, waits marked as tokens move.
  const step = new ProgressBound({ execution_s: 100 }, 0);
  step.observe(0, undefined, cpu(0));
  step.observe(200);                // a case ends: the step waits for a token
  step.observe(700, "memory");      // still waiting, now for memory
  step.observe(1000);               // granted
  const sampled = step.observe(2000, undefined, cpu(0.4, 0.6));
  assert.deepEqual([sampled.waited_s, sampled.cpu_s], [{ memory: 0.3 }, 0.4]);
  // Of the 1.7 s outside the wait, what it lost is at most the 0.6 s the counter names.
  assert.ok(Math.abs(sampled.used_s - 1.1) < 1e-9 && Math.abs(sampled.cpu_lost_s - 0.6) < 1e-9, JSON.stringify(sampled));
  const between = step.observe(2400, "slots");
  assert.ok(Math.abs(between.used_s - 1.1) < 1e-9, "an observation without a sample spends nothing yet");
  assert.equal(between.expired, undefined);
  const next = step.observe(3000, undefined, cpu(0.8, 0.6));
  assert.ok(Math.abs(next.used_s - 1.5) < 1e-9 && Math.abs(next.waited_s.slots! - 0.6) < 1e-9, JSON.stringify(next));
  // Lost CPU never exceeds the undeclared time it is set against.
  const capped = new ProgressBound({ execution_s: 100 }, 0);
  capped.observe(0, undefined, cpu(0));
  capped.observe(500, "priority");
  assert.deepEqual([capped.observe(1000, undefined, cpu(0, 1)).cpu_lost_s, capped.observe(1000).used_s], [0.5, 0]);
});

test("a step's CPU bound is its bound at every slot it may hold, and holds a spinner that the lost CPU it reports would excuse", () => {
  assert.equal(stepCpuBound({ seconds: 3, basis: "stated" }, 1), 3);
  assert.equal(stepCpuBound({ seconds: 6300, basis: "derived" }, 8), 50_400);
  for (const width of [0, -1, Number.NaN]) assert.throws(() => stepCpuBound({ seconds: 3, basis: "stated" }, width), /needs a positive width/);
  assert.equal(stepCpuBoundReason(3), "step exceeded its CPU bound of 3 cpu-s");
  // Threads past its width on CPUs that other work also takes: its loss excuses most of its time, its CPU does not.
  const spinner = new ProgressBound({ execution_s: 10, cpu_s: 30 }, 0);
  spinner.observe(0, undefined, cpu(0));
  const held = spinner.observe(8000, undefined, cpu(32, 7));
  assert.deepEqual([held.expired, held.used_s], ["cpu_s", 1]);
  // Outranked, a step whose work keeps it runnable loses its time and stays inside its bound.
  const outranked = new ProgressBound({ execution_s: 3, cpu_s: 3 }, 0);
  outranked.observe(0, undefined, cpu(0));
  const slowed = outranked.observe(30_000, undefined, cpu(0.3, 29.7));
  assert.deepEqual([slowed.expired, slowed.cpu_lost_s], [undefined, 29.7]);
  assert.equal(new ProgressBound({ execution_s: 3 }, 0).observe(30_000).expired, "execution_s", "the counterfactual: unsampled, the same 30 s spend its bound");
});

test("a stated bound wins; otherwise three times the step's work and the run's over their slots, above a floor", () => {
  const run = { cost: 2400, slots: 24 };
  assert.deepEqual(stepBound({ name: "s", bound: 7 }, 1e6, 8, run), { seconds: 7, basis: "stated" });
  // 3 * (16000 / 8 + 2400 / 24) = 3 * 2100
  assert.deepEqual(stepBound({ name: "s" }, 16000, 8, run), { seconds: 6300, basis: "derived" });
  assert.deepEqual(stepBound({ name: "s" }, 10, 8, run), { seconds: STEP_BOUND_FLOOR_S, basis: "derived" });
  assert.deepEqual(stepBound({ name: "s" }, 0, 1, { cost: 0, slots: 2 }), { seconds: STEP_BOUND_FLOOR_S, basis: "derived" }, "a check that took no measurable time");
  assert.deepEqual(stepBound({ name: "s", treeOnly: true }, 1, 1, { cost: 10, slots: 24 }), { seconds: TREE_CHECK_FLOOR_S, basis: "derived" });
  assert.equal(STEP_BOUND_FLOOR_S, 2 * COMMAND_CPU_BUDGET_SECONDS, "a supervised case reaches its own bound before its step's, even on half a core");
  for (const bound of [0, -1, Number.NaN, Infinity, "60"]) {
    assert.throws(() => stepBound({ name: "s", bound } as never, 1, 1, run), /s states a bound of .*, which is not a positive number of seconds/);
  }
  for (const [work, width, cost] of [[-1, 1, 1], [1, 0, 1], [Number.NaN, 1, 1], [1, 1, -1]]) {
    assert.throws(() => stepBound({ name: "s" }, work!, width!, { cost: cost!, slots: 1 }), /the bound of s needs a/);
  }
  assert.equal(stepBoundReason(6300), "step exceeded its bound of 6300 s");
  assert.deepEqual(instrumentPolicy("step-bound"), { verdict: "INSTRUMENT", disposition: "operator-hold" }, "a step stopped at its bound is held for a person");
});

test("a landing check's ceiling caps every bound: three times its estimate, at least fifteen minutes", () => {
  const run = { cost: 2400, slots: 24 };
  assert.equal(landingCeiling(100), LANDING_CEILING_FLOOR_S);
  assert.equal(LANDING_CEILING_FLOOR_S, 15 * 60);
  assert.equal(landingCeiling(600), 1800);
  assert.deepEqual(stepBound({ name: "s" }, 16000, 8, run, 900), { seconds: 900, basis: "ceiling" });
  assert.deepEqual(stepBound({ name: "s", bound: 7200 }, 0, 8, run, 900), { seconds: 900, basis: "ceiling" });
  assert.deepEqual(stepBound({ name: "s", bound: 60 }, 0, 8, run, 900), { seconds: 60, basis: "stated" }, "a bound under the ceiling stands");
  assert.deepEqual(stepBound({ name: "s", treeOnly: true }, 1, 1, run, 900), { seconds: 600, basis: "derived" }, "a tree check's own bound is under the ceiling");
  assert.deepEqual(stepBound({ name: "s" }, 1, 1, run, 900), { seconds: 900, basis: "ceiling" }, "the full check's hour floor does not apply under a ceiling");
  for (const ceiling of [0, -5, Number.NaN]) assert.throws(() => stepBound({ name: "s" }, 1, 1, run, ceiling), /step ceiling/);
  assert.throws(() => landingCeiling(-1), /landing estimate/);
});

test("every step the gate runs has a recorded cost or a stated bound", () => {
  assert.deepEqual(unmeasuredSteps(STEPS, baseline()), [], "a step with no committed baseline states its bound in step-table.mjs");
  assert.deepEqual(unmeasuredSteps([{ name: "new" }, { name: "tree", treeOnly: true }, { name: "stated", bound: 60 }], new Map()), ["new"]);
});

test("no bound would have stopped the committed healthy run", () => {
  // times.tsv is one green run of every step at 24 slots: each step's bound,
  // derived the way run.mjs derives it, lets that step run twice its wall.
  const times = baseline(), budget = { slots: 24, frontends: 24 };
  const width = (row: (typeof STEPS)[number]) => usableWidth(row, budget);
  const work = (row: (typeof STEPS)[number]) => times.get(row.name)?.cpu || (times.get(row.name)?.wall ?? 60) * width(row);
  const run = { cost: STEPS.reduce((sum, row) => sum + work(row), 0), slots: budget.slots };
  for (const row of STEPS) {
    const wall = times.get(row.name)?.wall;
    if (wall === undefined) continue;
    const { seconds } = stepBound(row, work(row), width(row), run);
    assert.ok(seconds >= 2 * wall, `${row.name}: a bound of ${seconds} s against the ${wall} s it took`);
  }
});

/**
 * What the step's slice is observed to do, in the fixture's own observations:
 * the clock stands at 0 until `format` moves it by `clockS`, and its slice's
 * cpu.stat usage by `usageS` and cpu.pressure `full` by `fullS`, all in one
 * write of the capability file. Then `format` exits, or waits for the release.
 * With `disk`, `format` first waits for disk through the one waiting owner
 * (admission.ts) for a capture its fixture's disk can never hold, and the
 * runner's ticks see that recorded wait before the clock moves.
 */
type Advance = { clockS: number; usageS: number; fullS: number; then: "exit" | "wait"; disk?: boolean };

/** How a fixture's runner runs: `format`'s command (else it sleeps until the test ends), or the observations it advances; a rank its run root takes beside every rank's work under nts.slice (else nested where the test runs); and live CPU counters. */
type FixtureRun = { owned?: Record<string, string>; format?: string[]; advance?: Advance; rank?: Priority; live?: boolean;
  /** Step table fields beside the bounds; observations beside the counters; a scheduling history the run starts from; `records` waiting for `format`'s disk wait. */
  rows?: Record<string, Record<string, unknown>>; observations?: { allocated?: { kind: "fixed"; defaultBytes: number }; disk?: { freeBytes: number; freeInodes: number } };
  history?: unknown; recordsFreesDisk?: boolean;
  /** While format waits for disk, records (elastic) takes this many pairs of tokens at once and returns them, before it frees the disk. */
  recordsTokenPairs?: number };

/**
 * A real runner in a scratch repository running `steps`, in a unit of its own
 * stopped by name: `format` runs its command or never finishes, `records`
 * finishes at once.
 */
function runFixture(t: { after: (fn: () => void) => void }, steps: string, bounds: Record<string, number>, { owned = {}, format, advance, rank, live = false, rows = {}, observations = {}, history, recordsFreesDisk = false, recordsTokenPairs = 0 }: FixtureRun = {}) {
  // The run's own TMPDIR inside a gate; the runner's directory sits under the fixture's HOME/.cache.
  const own = newTestScratch("step-bound");
  t.after(() => { writeFileSync(join(own, "release"), "the test is over"); removable(own); rmSync(own, { recursive: true, force: true }); });
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "home/.cache/gate-run");
  mkdirSync(gate, { recursive: true });
  mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("./", import.meta.url));
  for (const name of copyModuleClosure(["tooling/gate/run.mjs"],root)) {
    const destination = join(root, name), original = join(source, "../..", name);
    mkdirSync(dirname(destination), { recursive: true });
    if (name === "tooling/gate/step-table.mjs") {
      writeFileSync(destination, `import { STEPS as REAL, stepTableProblem } from ${JSON.stringify(pathToFileURL(original).href)};
const bounds = ${JSON.stringify(bounds)}, rows = ${JSON.stringify(rows)};
export const STEPS = REAL.map(row => ({ ...row, ...(Object.hasOwn(bounds, row.name) ? { bound: bounds[row.name] } : {}), ...(rows[row.name] ?? {}) }));
export { stepTableProblem };
`);
    }
  }
  symlinkSync(join(source, "token.sh"), join(gate, "token.sh"));
  writeFileSync(join(gate, "times.tsv"), "format\t1\t1\t1\nrecords\t1\t1\t1\n");
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  // An ample memory reading and a ledger of its own, as every test that starts
  // a real runner gives it; live, its own cgroups' CPU counters; advanced, a
  // clock that stands until the step moves it.
  const counters = live ? { cpu: { kind: "live" as const }, pressure: { kind: "live" as const } } : advance ? { clock: { kind: "fixed" as const, now: 0 } } : {};
  const memory = gateFixtureMemory(join(own, "memory"), root, { ...counters, ...observations });
  if (history !== undefined) { mkdirSync(memory.NTS_GATE_COSTS_DIR, { recursive: true }); writeFileSync(join(memory.NTS_GATE_COSTS_DIR, COST_HISTORY_NAME), JSON.stringify(history)); }
  writeFileSync(join(gate, "payload.mjs"), `
import { existsSync, readFileSync, watch } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { durableRecord } from ${JSON.stringify(pathToFileURL(join(source, "durable-record.ts")).href)};
const own = ${JSON.stringify(own)}, format = ${JSON.stringify(format ?? null)}, advance = ${JSON.stringify(advance ?? null)}, recordsFreesDisk = ${JSON.stringify(recordsFreesDisk)}, recordsTokenPairs = ${JSON.stringify(recordsTokenPairs)};
const observations = ${JSON.stringify(memory.NTS_HOST_OBSERVATIONS)};
const release = () => new Promise(resolve => { const watcher = watch(own, () => { if (existsSync(own + "/release")) { watcher.close(); resolve(); } }); });
// A step handed its temporary's claim says what it was handed, and that it ran.
if (process.env.NTS_GATE_STEP === "format") durableRecord(own + "/format-started.json", { disk: process.env.NTS_GATE_STEP_DISK ? JSON.parse(process.env.NTS_GATE_STEP_DISK) : null });
if (process.env.NTS_GATE_STEP === "records" && recordsFreesDisk) {
  // While format waits for disk: what the runner holds for it, then disk enough.
  const { DiskCapacity } = await import(${JSON.stringify(pathToFileURL(join(source, "disk-capacity.ts")).href)});
  const { readRunLifecycle } = await import(${JSON.stringify(pathToFileURL(join(source, "run-lifecycle.ts")).href)});
  const capacity = new DiskCapacity({});
  // Each wait is published whole into the capacity's own file: watch it.
  await new Promise(resolve => {
    const waiting = () => capacity.diskWaits().some(wait => wait.path.endsWith("/format"));
    const watcher = watch(dirname(capacity.waitStateFile), () => { if (waiting()) { watcher.close(); resolve(); } });
    if (waiting()) { watcher.close(); resolve(); }
  });
  durableRecord(own + "/while-waiting.json", { waits: capacity.diskWaits(), formatStarted: existsSync(own + "/format-started.json"), lifecycle: readRunLifecycle(process.env.NTS_GATE_RUN_DIR) });
  if (recordsTokenPairs) {
    // Every slot, again and again: a token returned is never kept back for
    // a step that waits for disk.
    const { tokenClient } = await import(${JSON.stringify(pathToFileURL(join(source, "tokens.mjs")).href)});
    const { releaseToken } = await import(${JSON.stringify(pathToFileURL(join(source, "case-context.ts")).href)});
    const client = tokenClient(process.env.NTS_GATE_TOKENS, "records");
    let pairs = 0;
    for (let i = 0; i < recordsTokenPairs; i++) {
      const held = await Promise.all([client.acquire({ scope: "step" }), client.acquire({ scope: "step" })]);
      for (const release of held) await releaseToken(release);
      pairs++;
    }
    durableRecord(own + "/neighbour.json", { pairs, formatStarted: existsSync(own + "/format-started.json") });
  }
  const value = JSON.parse(readFileSync(observations, "utf8"));
  value.disk = { freeBytes: 2 ** 52, freeInodes: 2 ** 30 };
  durableRecord(observations, value, { compact: true });
}
if (process.env.NTS_GATE_STEP === "format" && advance) {
  let diskWait = null;
  if (advance.disk) {
    const { TemporaryAdmission } = await import(${JSON.stringify(pathToFileURL(join(source, "admission.ts")).href)});
    const stop = new AbortController(), admission = new TemporaryAdmission({ path: own + "/capture", context: { kind: "standalone" }, reservedBytes: 2 ** 50 });
    const waited = admission.acquire({ what: "the fixture's capture", signal: stop.signal, report: line => console.log(line) })
      .then(() => { throw new Error("the fixture's capture was admitted"); }, error => { if (error?.name !== "AbortError") throw error; });
    diskWait = () => { stop.abort(); return waited; };
    await new Promise(resolve => setTimeout(resolve, 1500)); // three of the runner's bound ticks
  }
  // The step's slice, the one its runner gave it, as the user manager names its cgroup.
  const shown = spawnSync("systemctl", ["--user", "show", process.env.NTS_TOOLING_SLICE, "-p", "ControlGroup", "--value"], { encoding: "utf8" }), group = shown.stdout.trim();
  if (shown.status !== 0 || !group.endsWith("/" + process.env.NTS_TOOLING_SLICE)) throw new Error("the step's slice " + process.env.NTS_TOOLING_SLICE + " has no cgroup: " + shown.stderr);
  const us = seconds => Math.round(seconds * 1e6), value = JSON.parse(readFileSync(observations, "utf8"));
  value.clock = { kind: "fixed", now: value.clock.now + advance.clockS * 1000 };
  value.cpu.cgroups = { ...value.cpu.cgroups, [group]: { usageUsec: us(advance.usageS), userUsec: us(advance.usageS), systemUsec: 0 } };
  const reading = structuredClone(value.pressure.default);
  reading.identity = group + ":fixture";
  reading.resources.cpu.some.totalUsec = reading.resources.cpu.full.totalUsec = us(advance.fullS);
  value.pressure.cgroups = { ...value.pressure.cgroups, [group]: reading };
  durableRecord(observations, value, { compact: true });
  console.log("format advanced its observations: " + JSON.stringify(advance));
  if (advance.then === "wait") await release();
  await diskWait?.();
} else if (process.env.NTS_GATE_STEP === "format" && format) {
  const ran = spawnSync(format[0], format.slice(1), { stdio: "inherit" });
  console.log("format finished");
  process.exit(ran.status ?? 1);
} else if (process.env.NTS_GATE_STEP === "format") {
  console.log("format waits for a release that comes only after the test");
  await release();
} else console.log("records finished");
`);
  writeGateFixtureScript(join(gate, "all.sh"), `#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
  exec ${JSON.stringify(process.execPath)} "$(dirname "$0")/payload.mjs"
fi
`);
  // Ranked, the run's root is a sibling of every rank's work, not nested in the test's.
  const inherited = rank ? undefined : toolingSlice(), slice = rank ? undefined : inherited ?? newToolingSlice(true);
  if (slice && !inherited) t.after(() => stopToolingSlice(slice));
  const launcher: NodeJS.ProcessEnv = { ...hostEnvironment(process.env), HOME: join(own, "home") };
  if (rank) delete launcher.NTS_TOOLING_SLICE;
  const planned = gateEnvironment(launcher, { run, owned: {
    NTS_GATE_STEPS: steps, NTS_GATE_SLOTS: "2", ...memory, CARGO_TARGET_DIR: target,
    ...(slice ? { NTS_TOOLING_SLICE: slice } : {}), ...(rank ? { NTS_MEMORY_PRIORITY: rank } : {}), ...owned,
  } });
  const unit = `nts-test-step-bound-${randomUUID()}`;
  t.after(() => { spawnTest("systemctl", ["--user", "stop", unit], { encoding: "utf8" }); });
  const result = spawnTest("systemd-run", ["--user", `--unit=${unit}`, ...(slice ? [`--slice=${slice}`] : toolingSliceArgs({}, rank!)),
    "--collect", "--wait", "--pipe", "--quiet", `--working-directory=${root}`, "-p", "LimitCORE=0", "-p", "CPUAffinity=0-3 6-31", "-p", "RuntimeMaxSec=300s",
    ...Object.entries(planned.env).filter(([, value]) => value !== undefined).map(([name, value]) => `--setenv=${name}=${value}`),
    process.execPath, join(gate, "run.mjs")], { encoding: "utf8" });
  type Row = { name: string; verdict: string; reason: string; log: string; bound_s: number; bound_basis: string; wall: number; bound_cpu_s: number;
    disk?: { bytes: number; basis: string; peak_bytes: number; attempts: number };
    bound_clock: { execution_s: number; admission_wait_s: Partial<Record<string, number>>; cpu_s: number; cpu_lost_s: number; stalled_s: number };
    instrument?: { kind: string; verdict: string; reason: string }; scope?: { populated: number } };
  assert.ok(existsSync(join(run, "summary.json")), `the runner wrote no summary (exit ${result.status}):\n${result.stdout}${result.stderr}`);
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as { verdict: string; steps: Row[]; interrupted: unknown; scope_cleanup: { state: string } };
  const step = (name: string) => summary.steps.find(row => row.name === name)!;
  return { result, summary, run, own, costs: memory.NTS_GATE_COSTS_DIR, format: step("format"), records: step("records") };
}

test("a step past its bound is stopped through its scope and held, its log kept, and the run finishes", t => {
  const { result, summary, format, records } = runFixture(t, "format records", { format: 3 }, { live: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.signal, null);
  assert.equal(format.verdict, "INSTRUMENT", result.stdout);
  assert.equal(format.reason, "step exceeded its bound of 3 s");
  assert.deepEqual(format.instrument, { kind: "step-bound", verdict: "INSTRUMENT", reason: "step exceeded its bound of 3 s" });
  assert.equal(format.bound_s, 3);
  assert.equal(format.bound_basis, "stated");
  assert.equal(format.scope?.populated, 0, "its scope was drained");
  assert.match(readFileSync(format.log, "utf8"), /\nstep exceeded its bound of 3 s: stopped through its scope\n$/);
  assert.match(result.stdout.replace(/\x1b\[[0-9;]*m/g, ""), /^INSTRUMENT: format -- step exceeded its bound of 3 s$/m);
  // The run went on and finished as any run does.
  assert.equal(records.verdict, "PASS", result.stdout);
  assert.equal(summary.interrupted, null);
  assert.equal(summary.scope_cleanup.state, "complete");
});

test("a step within its bound is untouched, and the runner publishes its step lifecycle", t => {
  const { result, summary, records, run } = runFixture(t, "records", { records: 30 });
  assert.deepEqual(readRunLifecycle(run), { version: 1, events: 2, running: [] }, "it started and finished, for the full check's lifecycle bound");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(summary.verdict, "green");
  assert.equal(records.verdict, "PASS");
  assert.equal(records.reason, "");
  assert.equal(records.instrument, undefined);
  assert.deepEqual([records.bound_s, records.bound_basis], [30, "stated"]);
  assert.equal(readFileSync(records.log, "utf8"), "records finished\n");
});

test("under a landing check's ceiling, a step is stopped there whatever its own bound", t => {
  const { result, format, records } = runFixture(t, "format records", { format: 7200 }, { owned: { NTS_GATE_STEP_CEILING_S: "3" } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(format.verdict, "INSTRUMENT");
  assert.equal(format.reason, "step exceeded its bound of 3 s");
  assert.deepEqual([format.bound_s, format.bound_basis], [3, "ceiling"]);
  assert.equal(records.verdict, "PASS");
  assert.deepEqual([records.bound_s, records.bound_basis], [3, "ceiling"]);
});

test("a step whose slice is observed to lose CPU to other work spends none of that time; without the loss, the same time spends its bound", t => {
  // Owned observations decide it, not the machine: 30 s pass on the
  // fixture's clock while the step's own slice runs 0.3 s and is runnable
  // with none of it running (cpu.pressure `full`) for 29.7 s. Keyed by the
  // step's own cgroup, a runner that sampled any other cgroup would read the
  // default zeros and spend the 30 s.
  const lost = runFixture(t, "format", { format: 3 }, { advance: { clockS: 30, usageS: 0.3, fullS: 29.7, then: "exit" } });
  assert.equal(lost.result.status, 0, lost.result.stdout + lost.result.stderr);
  assert.equal(lost.format.verdict, "PASS", lost.format.reason);
  const clock = lost.format.bound_clock;
  t.diagnostic(`lost: ${JSON.stringify(clock)}`);
  assert.ok(Math.abs(clock.execution_s - 0.3) < 1e-6 && Math.abs(clock.cpu_lost_s - 29.7) < 1e-6 && Math.abs(clock.cpu_s - 0.3) < 1e-6,
    `of 30 s, the 29.7 s its slice lost spent nothing and the 0.3 s it ran did: ${JSON.stringify(clock)}`);
  // The counterfactual: the same 30 s, with no loss observed, spend its bound.
  const kept = runFixture(t, "format", { format: 3 }, { advance: { clockS: 30, usageS: 0.3, fullS: 0, then: "wait" } });
  assert.equal(kept.result.status, 1, kept.result.stdout + kept.result.stderr);
  assert.equal(kept.format.verdict, "INSTRUMENT", kept.result.stdout);
  assert.equal(kept.format.reason, "step exceeded its bound of 3 s");
  assert.ok(kept.format.bound_clock.execution_s >= 30 && kept.format.bound_clock.cpu_lost_s === 0, JSON.stringify(kept.format.bound_clock));
});

test("a fixed step's own recorded disk wait spends none of its execution bound; the same time without it spends its bound", t => {
  // 30 s pass on the fixture's clock while `format`'s capture waits for disk
  // its fixture can never hold, and its slice runs 0.3 s: the wait is the
  // step's own, recorded by its one owner, so the step is decided, not held.
  const waited = runFixture(t, "format", { format: 3 }, { advance: { clockS: 30, usageS: 0.3, fullS: 0, then: "exit", disk: true } });
  assert.equal(waited.result.status, 0, waited.result.stdout + waited.result.stderr);
  assert.equal(waited.format.verdict, "PASS", waited.format.reason);
  const clock = waited.format.bound_clock;
  t.diagnostic(`waited: ${JSON.stringify(clock)}`);
  assert.ok(clock.execution_s < 3 && clock.admission_wait_s.disk! >= 30 && Math.abs(clock.cpu_s - 0.3) < 1e-6, `the 30 s of its disk wait spent nothing: ${JSON.stringify(clock)}`);
  const log = readFileSync(waited.format.log, "utf8");
  assert.match(log, /disk: the fixture's capture waits for /);
  assert.match(log, /\nstep budget: .* s execution; admission waits \{"disk":3\d(\.\d+)?\};.*waited 3\d s for disk/, "its log names the wait it spent nothing on");
  // The control is the lost-CPU test's counterfactual: the same 30 s with no
  // recorded wait and no loss spend the bound, and the step is held.
});

test("a step that spins while its disk wait is recorded is still stopped at its CPU bound", t => {
  // In 5 s on the fixture's clock its slice runs 25 cpu-s, past the 20 cpu-s
  // of a 20 s bound at width 1, while its capture's disk wait stays recorded:
  // a disk wait excuses time, never CPU.
  const { result, format } = runFixture(t, "format", { format: 20 }, { advance: { clockS: 5, usageS: 25, fullS: 0, then: "wait", disk: true } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(format.verdict, "INSTRUMENT", result.stdout);
  assert.equal(format.reason, "step exceeded its CPU bound of 20 cpu-s");
  assert.ok(Math.abs(format.bound_clock.cpu_s - 25) < 1e-6 && format.bound_clock.execution_s < 5, JSON.stringify(format.bound_clock));
});

const GiB = 2 ** 30;
/** The claim `format` was handed, and its history's disk peaks after the run. */
const handed = (own: string) => (JSON.parse(readFileSync(join(own, "format-started.json"), "utf8")) as { disk: { path: string; bytes: number; id: string } | null }).disk;
const diskPeaks = (run: { costs: string }) => readCostHistory(join(run.costs, COST_HISTORY_NAME), () => {}).steps.get("format")?.disk?.peaks;

test("a step waiting for its temporary's disk holds neither slots nor memory, and starts with the claim once the disk frees", t => {
  // The fixture's disk holds 1 GiB above the floor; format's temporary
  // claims 2 GiB, never measured. records, running beside it, sees format's
  // wait recorded while format has not started and only records runs, then
  // frees the disk.
  const tight = { freeBytes: 41 * GiB, freeInodes: 2 ** 30 };
  const ran = runFixture(t, "format records", { format: 30, records: 30 }, { rows: { format: { unmeasuredDisk: 2 * GiB } }, observations: { disk: tight }, recordsFreesDisk: true, format: ["true"] });
  assert.equal(ran.result.status, 0, ran.result.stdout + ran.result.stderr);
  assert.equal(ran.format.verdict, "PASS", ran.format.reason);
  const own = ran.own;
  const seen = JSON.parse(readFileSync(join(own, "while-waiting.json"), "utf8")) as { waits: { path: string; bytes: number }[]; formatStarted: boolean; lifecycle: { running: string[] } };
  assert.equal(seen.formatStarted, false, "format did not start while it waited");
  assert.deepEqual(seen.lifecycle.running, ["records"], "only records ran: format held no slot and no memory of the run");
  assert.deepEqual(seen.waits.map(wait => [wait.path.split("/").at(-1), wait.bytes]), [["format", 2 * GiB]], "its wait was recorded, in its runner's name");
  const claim = handed(own);
  assert.ok(claim && claim.path.endsWith("/format") && claim.bytes === 2 * GiB, JSON.stringify(claim));
  assert.match(ran.result.stdout, /disk: format's temporary \(2\.0 GiB, unmeasured\) waits for /);
  assert.match(ran.result.stdout, /disk: format's temporary \(2\.0 GiB, unmeasured\) admitted after \d+ s/);
});

test("a step waiting for disk is asked again only at its look time, and keeps back no slot from an elastic neighbour returning tokens", t => {
  // format needs both slots and 2 GiB its disk cannot hold; records, elastic,
  // takes both slots and returns them 300 times while format waits, each
  // return a scheduling pass. A step that withheld returned tokens for itself
  // would hold records' second token back; one asked again on every pass
  // would try its disk hundreds of times.
  const tight = { freeBytes: 41 * GiB, freeInodes: 2 ** 30 };
  const ran = runFixture(t, "format records", { format: 60, records: 60 }, {
    rows: { format: { unmeasuredDisk: 2 * GiB, slots: 2, min: 2 }, records: { elastic: true, slots: 2 } },
    observations: { disk: tight }, recordsFreesDisk: true, recordsTokenPairs: 300, format: ["true"] });
  assert.equal(ran.result.status, 0, ran.result.stdout + ran.result.stderr);
  assert.equal(ran.format.verdict, "PASS", ran.format.reason);
  const neighbour = JSON.parse(readFileSync(join(ran.own, "neighbour.json"), "utf8")) as { pairs: number; formatStarted: boolean };
  assert.deepEqual(neighbour, { pairs: 300, formatStarted: false }, "records held both slots on every pass while format waited");
  const disk = ran.format.disk!;
  const admitted = Number(/disk: format's temporary \(2\.0 GiB, unmeasured\) admitted after (\d+) s/.exec(ran.result.stdout)?.[1]);
  t.diagnostic(`attempts ${disk.attempts}, admitted after ${admitted} s`);
  assert.ok(disk.attempts <= 2 + Math.ceil(admitted / 5), `about one try per 5 s look: ${disk.attempts} tries in ${admitted} s`);
  assert.equal(disk.bytes, 2 * GiB);
});

test("a step's temporary claims what it was measured to hold, with the margin, and records what it held this time", t => {
  // A history with one measured peak of 3 GiB: the claim is 1.25 times it,
  // not the table's unmeasured 1 GiB; this run's temporary holds 2 GiB,
  // which joins the peaks.
  const history = { version: 6, cpu_measure: STEP_CPU_MEASURE, steps: { format: { disk: { unit: "step", peaks: [3 * GiB] } } }, jobs: {} };
  const ran = runFixture(t, "format", { format: 30 }, { rows: { format: { unmeasuredDisk: GiB } }, observations: { allocated: { kind: "fixed", defaultBytes: 2 * GiB } }, history, format: ["true"] });
  assert.equal(ran.result.status, 0, ran.result.stdout + ran.result.stderr);
  assert.equal(ran.format.verdict, "PASS", ran.format.reason);
  assert.equal(handed(ran.own)?.bytes, Math.ceil(1.25 * 3 * 1024) * 2 ** 20);
  assert.deepEqual(diskPeaks(ran), [3 * GiB, 2 * GiB]);
});

test("a step whose temporary outgrows its claim is stopped and held by name, and its next claim covers what it held", t => {
  // Unmeasured, format claims 1 GiB; its temporary holds 2 GiB.
  const ran = runFixture(t, "format", { format: 30 }, { rows: { format: { unmeasuredDisk: GiB } }, observations: { allocated: { kind: "fixed", defaultBytes: 2 * GiB } } });
  assert.equal(ran.result.status, 1, ran.result.stdout + ran.result.stderr);
  assert.equal(ran.format.verdict, "INSTRUMENT", ran.result.stdout);
  assert.equal(ran.format.reason, "its temporary outgrew its disk claim of 1.0 GiB (unmeasured): it holds 2.0 GiB");
  assert.equal(ran.format.scope?.populated, 0, "its scope was drained");
  assert.deepEqual(diskPeaks(ran), [2 * GiB]);
});

// One gate CPU, outside the measurement CPUs, for a control and its competitor alike.
const lastGateCpu = () => gateCpus(inheritedCpus()).split(",").at(-1)!.split("-").at(-1)!;
const loop = (iterations: number) => `i=0; while [ $i -lt ${iterations} ]; do i=$((i+1)); done`;

type LoopPlacement = { group: string; pids: number[]; cpuset?: string; mask?: string; comm?: string; state?: string; processor?: number };

function placementFault(unit: string, cpu: string, reading: LoopPlacement, why: string): HostStateError {
  return new HostStateError("tooling-setup", `kernel CPU control ${unit} in slice nts.slice (${reading.group || "no cgroup"}): ${why}; requested CPU ${cpu}, slice effective cpuset ${reading.cpuset ?? "unavailable (no process)"}, mask ${reading.mask ?? "unavailable"}, image ${reading.comm ?? "unavailable"}, members ${reading.pids.join(" ") || "none"}`);
}

function loopSample<T>(unit: string, cpu: string, placement: LoopPlacement, read: () => T): T {
  try { return read(); }
  catch (error) { throw placementFault(unit, cpu, placement, `cannot sample the loop's cgroup: ${String(error)}`); }
}

async function waitForLoop(unit: string, cpu: string, observe: () => LoopPlacement): Promise<LoopPlacement> {
  let reading: LoopPlacement = { group: "", pids: [] };
  try {
    await waitFor(`${unit}'s exec'd sh alone and runnable on CPU ${cpu}`, () => {
      reading = observe();
      if (reading.cpuset && !cpuList(reading.cpuset).includes(Number(cpu))) throw placementFault(unit, cpu, reading, "slice excludes the requested CPU");
      return reading.pids.length === 1 && reading.comm === "sh" && reading.mask === cpu && reading.state === "R" && String(reading.processor) === cpu;
    }, { stopped: () => reading.state === "Z" || !reading.group || reading.pids.length === 0 ? "unit has no live loop" : undefined });
    return reading;
  } catch (error) {
    if (error instanceof HostStateError) throw error;
    throw placementFault(unit, cpu, reading, String(error));
  }
}

test("the kernel control waits past the pre-exec child and broad mask before sampling", async () => {
  const base: LoopPlacement = { group: "/nts.slice/control.service", pids: [123], cpuset: "0-3,6-31", mask: "0-3,6-31", comm: "(sh)", state: "R", processor: 30 };
  const ready = { ...base, mask: "31", comm: "sh", processor: 31 };
  const observations = [base, { ...base, mask: "31", processor: 31 }, { ...ready, mask: "0-3,6-31" }, { ...ready, state: "S" }, ready];
  let reads = 0, samples = 0;
  const reading = await waitForLoop("control.service", "31", () => {
    assert.equal(samples, 0, "no PSI baseline before placement is ready");
    return observations[reads++]!;
  });
  samples++;
  assert.equal(reads, observations.length);
  assert.equal(reading, ready);
  assert.equal(samples, 1);
});

test("an impossible kernel-control placement is an instrument refusal naming the slice cpuset", async t => {
  const dir = newTestScratch("step-bound-placement");
  t.after(() => { removable(dir); rmSync(dir, { recursive: true, force: true }); });
  const reading: LoopPlacement = { group: "/nts.slice/control.service", pids: [123], cpuset: "0-3,6-30", mask: "0-3,6-30", comm: "sh", state: "R", processor: 30 };
  assert.throws(() => loopSample("control.service", "31", reading, () => { throw Error("loop cgroup disappeared"); }), error => {
    assert.ok(error instanceof HostStateError);
    assert.match(error.message, /cannot sample the loop's cgroup: Error: loop cgroup disappeared/);
    assert.match(error.message, /slice effective cpuset 0-3,6-30, mask 0-3,6-30/);
    return true;
  });
  for (const observation of [reading, { group: "", pids: [] }]) {
    let fault: HostStateError | undefined;
    await assert.rejects(waitForLoop("control.service", "31", () => observation), error => {
      assert.ok(error instanceof HostStateError); fault = error; return true;
    });
    assert.ok(fault);
    assert.match(fault.message, /control.service in slice nts.slice/);
    assert.match(fault.message, /slice effective cpuset/);
    if (observation === reading) assert.match(fault.message, /slice effective cpuset 0-3,6-30, mask 0-3,6-30/);
    // This exact marker, rather than an ordinary ToolingInstrumentError,
    // is what the tooling entry recognizes as a host fault, not a FAIL.
    assert.equal(completedHostFault({ details: { error: { failureType: "testCodeFailure", cause: fault } } }), fault);
    const env = { NTS_GATE_STEP: "tooling", NTS_GATE_STEP_ATTEMPT: "placement", NTS_GATE_STEP_RESULT: join(dir, "instrument.json") };
    publishToolingFailure(fault, env);
    const frame = readStepInstrument(env.NTS_GATE_STEP_RESULT, "tooling", "placement");
    assert.equal(frame?.verdict, "INSTRUMENT");
    assert.equal(frame?.kind, "tooling-setup");
    assert.equal(frame?.reason, fault.message);
  }
});

test("a task alone in its cgroup and always runnable on one CPU is either running or counted in cpu.pressure full, whatever else holds that CPU", async t => {
  // The premise: the loop is its cgroup's only task, always runnable, on one
  // CPU. Every moment of it is then either on the CPU (cpu.stat usage) or
  // runnable and not running, which `full` counts exactly for a cgroup busy on
  // one CPU. Whoever else takes the CPU, this landing-weight spinner or any
  // load around the test, only moves time from one counter to the other, so
  // the sum covers the interval at any load. The counters bracket the clock:
  // the first sample's moment is read after its counters, the second's before.
  const cpu = lastGateCpu(), dir = newTestScratch("step-bound-psi");
  t.after(() => { removable(dir); rmSync(dir, { recursive: true, force: true }); });
  assert.ok(cpu !== "4" && cpu !== "5", `the loop's CPU ${cpu} is a measurement CPU`);
  const host = hostObservations(ownMemory(dir, { cpu: { kind: "live" }, pressure: { kind: "live" }, clock: { kind: "live" }, resident: { kind: "live" } }));
  const spinner = `nts-test-step-bound-spinner-${randomUUID()}`, looper = `nts-test-step-bound-loop-${randomUUID()}`;
  // Runaway bounds only: nothing in the arm waits on them.
  const observe = (unit: string): LoopPlacement => {
    let reading: LoopPlacement = { group: "", pids: [] };
    try {
      const shown = spawnTest("systemctl", ["--user", "show", unit, "-p", "ControlGroup", "--value"], { encoding: "utf8" });
      if (shown.status !== 0) throw Error(shown.stderr);
      const group = shown.stdout.trim();
      if (!/^\/.+\.service$/.test(group)) return reading;
      reading.group = group;
      reading.pids = host.cgroupMembers(group);
      const pid = reading.pids[0];
      if (pid !== undefined) {
        reading.cpuset = effectiveCeiling(pid);
        reading.mask = inheritedCpus(pid);
        const stat = readProcessStat(pid);
        reading.comm = stat?.comm;
        reading.state = stat?.state;
        reading.processor = stat?.processor;
      }
      return reading;
    } catch (error) { throw placementFault(unit, cpu, reading, `cannot observe placement: ${String(error)}`); }
  };
  const start = async (unit: string, rank: Priority) => {
    // simple reports the fork, while its '(sh)' child still has the
    // manager's mask. exec reports successful execution setup instead.
    try {
      const started = spawnTest("systemd-run", ["--user", `--unit=${unit}`, ...toolingSliceArgs({}, rank), "--collect", "--quiet",
        "-p", "Type=exec", "-p", "LimitCORE=0", "-p", "RuntimeMaxSec=120s", "-p", `CPUAffinity=${cpu}`, "sh", "-c", "while :; do :; done"], { encoding: "utf8" });
      if (started.status !== 0) throw Error(started.stderr || String(started.error));
    } catch (error) {
      let reading: LoopPlacement = { group: "", pids: [] };
      try { reading = observe(unit); } catch { /* The launch diagnostic still names the unavailable placement. */ }
      throw placementFault(unit, cpu, reading, `launch failed: ${String(error)}`);
    }
    return waitForLoop(unit, cpu, () => observe(unit));
  };
  try {
    await start(spinner, "landing");
    const placement = await start(looper, "full-check"), { group } = placement, pid = placement.pids[0]!;
    const sample = () => loopSample(looper, cpu, placement, () => host.cgroupCpuSample(group));
    const first = sample();
    await new Promise(resolve => setTimeout(resolve, 2000)); // the measured interval
    const at = host.now(), second = sample();
    const final = observe(looper);
    if (final.pids.length !== 1 || final.pids[0] !== pid || final.mask !== cpu || final.comm !== "sh" || String(final.processor) !== cpu)
      throw placementFault(looper, cpu, final, "loop placement changed during measurement");
    const interval = (at - first.atMs) / 1000, ran = (second.cpu.usageUsec - first.cpu.usageUsec) / 1e6;
    const waited = (second.pressure.resources.cpu.full.totalUsec - first.pressure.resources.cpu.full.totalUsec) / 1e6;
    const seen = `on CPU ${cpu}, ${group} ran ${ran.toFixed(3)} s and lost ${waited.toFixed(3)} s to other work (cpu.pressure full) in ${interval.toFixed(3)} s`;
    t.diagnostic(seen);
    assert.ok(interval >= 1, `the interval is ${interval} s`);
    assert.ok(ran + waited >= 0.95 * interval, `every moment is run or excused as lost: ${seen}`);
    assert.ok(waited > 0, `the spinner took some of the CPU, excused as lost: ${seen}`);
  } finally {
    for (const unit of [looper, spinner]) spawnTest("systemctl", ["--user", "stop", unit], { encoding: "utf8" });
  }
});

test("a step whose own threads oversubscribe its one CPU spends its bound for the time it runs: competing with itself is no loss", t => {
  // Four threads of bounded work on one CPU: some thread always waits (cpu.pressure `some`), yet one always runs (`full` stays near zero).
  const cpu = lastGateCpu(), work = `for t in 1 2 3 4; do (${loop(100_000)}) & done; wait`;
  const { result, format } = runFixture(t, "format", { format: 600 }, { live: true, format: ["taskset", "-c", cpu, "sh", "-c", work] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(format.verdict, "PASS", format.reason);
  const clock = format.bound_clock;
  t.diagnostic(`${format.wall} s: ${JSON.stringify(clock)}`);
  assert.ok(clock.cpu_s >= 0.5 && clock.execution_s >= 0.9 * clock.cpu_s, `its execution covers the CPU it ran: ${JSON.stringify(clock)}`);
});

test("a step running past its width is stopped through its scope at its CPU bound, by name", t => {
  // Owned observations: in 5 s on the fixture's clock its slice runs 25 cpu-s,
  // past the 20 cpu-s of a 20 s bound at width 1, long before the bound.
  const { result, format } = runFixture(t, "format", { format: 20 }, { advance: { clockS: 5, usageS: 25, fullS: 0, then: "wait" } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(format.verdict, "INSTRUMENT", result.stdout);
  assert.equal(format.bound_cpu_s, 20);
  assert.equal(format.reason, "step exceeded its CPU bound of 20 cpu-s");
  assert.deepEqual(format.instrument, { kind: "step-bound", verdict: "INSTRUMENT", reason: "step exceeded its CPU bound of 20 cpu-s" });
  assert.equal(format.scope?.populated, 0, "its scope was drained");
  assert.match(readFileSync(format.log, "utf8"), /\nstep exceeded its CPU bound of 20 cpu-s: stopped through its scope\n$/);
  assert.ok(Math.abs(format.bound_clock.cpu_s - 25) < 1e-6 && Math.abs(format.bound_clock.execution_s - 5) < 1e-6, JSON.stringify(format.bound_clock));
});
