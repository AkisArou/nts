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
import {readStepBaseline} from "./step-time.ts";
import { COMMAND_CPU_BUDGET_SECONDS } from "./active-command.ts";
import {gateEnvironment} from './canonical-environment.ts';
import {hostEnvironment} from './host-environment.ts';
import { LANDING_CEILING_FLOOR_S, STEP_BOUND_FLOOR_S, TREE_CHECK_FLOOR_S, ProgressBound, landingCeiling, progressSummary, stepBound, stepBoundReason, stepBoundWait, stepCpuBound, stepCpuBoundReason, unmeasuredSteps } from "./step-bound.ts";
import { instrumentPolicy } from "./step-result.ts";
import { readRunLifecycle } from "./run-lifecycle.ts";
import { usableWidth } from "./step-scheduling.ts";
import { STEPS } from "./step-table.mjs";
import { spawnTest } from "./test-wait.ts";
import { newTestScratch } from "./test-scratch.ts";
import {copyModuleClosure} from "./module-closure-fixture.ts";
import { removable } from "./run-temporary.ts";
import { randomUUID } from "node:crypto";
import { gateCpus, inheritedCpus } from "./affinity.ts";
import { newToolingSlice, stopToolingSlice, toolingSlice, toolingSliceArgs } from "./tooling-slice.ts";
import type { Priority } from "./ranks.ts";

// These are arithmetic policy vectors, not comparisons of measured CPU.
const baseline = () => readStepBaseline(readFileSync(new URL("./times.tsv", import.meta.url), "utf8"));

test("only a gate-owned admission wait with no executing case suspends a step's execution budget", () => {
  const ready = { elastic:true, held:0, outranked:false, requests:[8,4], freeSlots:1, freeFrontends:1, freeBytes:4 };
  assert.equal(stepBoundWait(ready), undefined, "one eligible request can execute");
  assert.equal(stepBoundWait({...ready,freeBytes:3}), "memory");
  assert.equal(stepBoundWait({...ready,freeSlots:0}), "slots");
  assert.equal(stepBoundWait({...ready,freeFrontends:0}), "frontends");
  assert.equal(stepBoundWait({...ready,outranked:true,requests:[]}), "priority", "a yielding feed asks for no new token");
  assert.equal(stepBoundWait({...ready,held:1,outranked:true,freeBytes:0}), undefined, "an executing case consumes the budget throughout");
  assert.equal(stepBoundWait({...ready,requests:[],freeBytes:0}), undefined, "a script with no admission request consumes the budget");
  assert.equal(stepBoundWait({...ready,elastic:false,outranked:true}), undefined, "a fixed step's work is not tracked by tokens");
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

/** How a fixture's runner runs: `format`'s command (else it sleeps until the test ends), a rank its run root takes beside every rank's work under nts.slice (else nested where the test runs), and live CPU counters. */
type FixtureRun = { owned?: Record<string, string>; format?: string[]; rank?: Priority; live?: boolean };

/**
 * A real runner in a scratch repository running `steps`, in a unit of its own
 * stopped by name: `format` runs its command or never finishes, `records`
 * finishes at once.
 */
function runFixture(t: { after: (fn: () => void) => void }, steps: string, bounds: Record<string, number>, { owned = {}, format, rank, live = false }: FixtureRun = {}) {
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
const bounds = ${JSON.stringify(bounds)};
export const STEPS = REAL.map(row => Object.hasOwn(bounds, row.name) ? { ...row, bound: bounds[row.name] } : row);
export { stepTableProblem };
`);
    }
  }
  symlinkSync(join(source, "token.sh"), join(gate, "token.sh"));
  writeFileSync(join(gate, "times.tsv"), "format\t1\t1\t1\nrecords\t1\t1\t1\n");
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  writeFileSync(join(gate, "payload.mjs"), `
import { existsSync, watch } from "node:fs";
import { spawnSync } from "node:child_process";
const own = ${JSON.stringify(own)}, format = ${JSON.stringify(format ?? null)};
if (process.env.NTS_GATE_STEP === "format" && format) {
  const ran = spawnSync(format[0], format.slice(1), { stdio: "inherit" });
  console.log("format finished");
  process.exit(ran.status ?? 1);
} else if (process.env.NTS_GATE_STEP === "format") {
  console.log("format waits for a release that comes only after the test");
  await new Promise(resolve => { const watcher = watch(own, () => { if (existsSync(own + "/release")) { watcher.close(); resolve(); } }); });
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
  // An ample memory reading and a ledger of its own, as every test that starts
  // a real runner gives it; live, its own cgroups' CPU counters.
  const counters = live ? { cpu: { kind: "live" as const }, pressure: { kind: "live" as const } } : {};
  // Ranked, the run's root is a sibling of every rank's work, not nested in the test's.
  const inherited = rank ? undefined : toolingSlice(), slice = rank ? undefined : inherited ?? newToolingSlice(true);
  if (slice && !inherited) t.after(() => stopToolingSlice(slice));
  const launcher: NodeJS.ProcessEnv = { ...hostEnvironment(process.env), HOME: join(own, "home") };
  if (rank) delete launcher.NTS_TOOLING_SLICE;
  const planned = gateEnvironment(launcher, { run, owned: {
    NTS_GATE_STEPS: steps, NTS_GATE_SLOTS: "2", ...gateFixtureMemory(join(own, "memory"), root, counters), CARGO_TARGET_DIR: target,
    ...(slice ? { NTS_TOOLING_SLICE: slice } : {}), ...(rank ? { NTS_MEMORY_PRIORITY: rank } : {}), ...owned,
  } });
  const unit = `nts-test-step-bound-${randomUUID()}`;
  t.after(() => { spawnTest("systemctl", ["--user", "stop", unit], { encoding: "utf8" }); });
  const result = spawnTest("systemd-run", ["--user", `--unit=${unit}`, ...(slice ? [`--slice=${slice}`] : toolingSliceArgs({}, rank!)),
    "--collect", "--wait", "--pipe", "--quiet", `--working-directory=${root}`, "-p", "LimitCORE=0", "-p", "CPUAffinity=0-3 6-31", "-p", "RuntimeMaxSec=300s",
    ...Object.entries(planned.env).filter(([, value]) => value !== undefined).map(([name, value]) => `--setenv=${name}=${value}`),
    process.execPath, join(gate, "run.mjs")], { encoding: "utf8" });
  type Row = { name: string; verdict: string; reason: string; log: string; bound_s: number; bound_basis: string; wall: number; bound_cpu_s: number;
    bound_clock: { execution_s: number; cpu_s: number; cpu_lost_s: number; stalled_s: number };
    instrument?: { kind: string; verdict: string; reason: string }; scope?: { populated: number } };
  assert.ok(existsSync(join(run, "summary.json")), `the runner wrote no summary (exit ${result.status}):\n${result.stdout}${result.stderr}`);
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as { verdict: string; steps: Row[]; interrupted: unknown; scope_cleanup: { state: string } };
  const step = (name: string) => summary.steps.find(row => row.name === name)!;
  return { result, summary, run, format: step("format"), records: step("records") };
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

// One gate CPU, outside the measurement CPUs, for a control and its competitor alike.
const lastGateCpu = () => gateCpus(inheritedCpus()).split(",").at(-1)!.split("-").at(-1)!;
const loop = (iterations: number) => `i=0; while [ $i -lt ${iterations} ]; do i=$((i+1)); done`;

test("a step outranked for its CPU by landing-weight work stays inside its bound however long that work holds the CPU", t => {
  // The step's loop and a landing-weight spinner share one CPU, where cpu.pressure `full` is exact; its run's root is at the full check's weight.
  const cpu = lastGateCpu(), spinner = `nts-test-step-bound-spinner-${randomUUID()}`;
  t.after(() => { spawnTest("systemctl", ["--user", "stop", spinner], { encoding: "utf8" }); });
  const spun = spawnTest("systemd-run", ["--user", `--unit=${spinner}`, ...toolingSliceArgs({}, "landing"), "--collect", "--quiet",
    "-p", "LimitCORE=0", "-p", "RuntimeMaxSec=300s", "taskset", "-c", cpu, "sh", "-c", "while :; do :; done"], { encoding: "utf8" });
  assert.equal(spun.status, 0, spun.stderr);
  const { result, format } = runFixture(t, "format", { format: 3 }, { live: true, rank: "full-check", format: ["taskset", "-c", cpu, "sh", "-c", loop(100_000)] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(format.verdict, "PASS", format.reason);
  const clock = format.bound_clock;
  t.diagnostic(`${format.wall} s: ${JSON.stringify(clock)}`);
  assert.ok(clock.cpu_lost_s > 3 && clock.execution_s < 3, `it lost more than its bound of 3 s to the spinner and spent less: ${JSON.stringify(clock)} in ${format.wall} s`);
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

test("a step spinning past its width is stopped through its scope at its CPU bound, by name", t => {
  // Eight spinning threads for a step of width 1, at an agent's rank: it runs
  // more than one CPU-second per second unless the machine gives it less than
  // an eighth of each of eight CPUs, so its CPU bound comes before its bound.
  const work = "for t in 1 2 3 4 5 6 7 8; do (while :; do :; done) & done; wait";
  const { result, format } = runFixture(t, "format", { format: 20 }, { live: true, rank: "agent", format: ["sh", "-c", work] });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(format.verdict, "INSTRUMENT", result.stdout);
  assert.equal(format.bound_cpu_s, 20);
  assert.equal(format.reason, "step exceeded its CPU bound of 20 cpu-s");
  assert.deepEqual(format.instrument, { kind: "step-bound", verdict: "INSTRUMENT", reason: "step exceeded its CPU bound of 20 cpu-s" });
  assert.equal(format.scope?.populated, 0, "its scope was drained");
  assert.match(readFileSync(format.log, "utf8"), /\nstep exceeded its CPU bound of 20 cpu-s: stopped through its scope\n$/);
  t.diagnostic(`${format.wall} s: ${JSON.stringify(format.bound_clock)}`);
  assert.ok(format.bound_clock.cpu_s >= 20 && format.bound_clock.execution_s < 20, JSON.stringify(format.bound_clock));
});
