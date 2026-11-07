// The step bound (step-bound.ts), the committed table it reads, and the runner
// that applies it (run.mjs): a step past its bound is stopped through its own
// scope and held, and a step within its bound is untouched.
//
//   node --test tooling/gate/step-bound.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBaseline } from "../landing/selection.ts";
import { COMMAND_CPU_BUDGET_SECONDS } from "./active-command.ts";
import { gateEnvironment, hostEnvironment } from "./canonical-environment.ts";
import { LANDING_CEILING_FLOOR_S, STEP_BOUND_FLOOR_S, TREE_CHECK_FLOOR_S, landingCeiling, stepBound, stepBoundReason, unmeasuredSteps } from "./step-bound.ts";
import { instrumentPolicy } from "./step-result.ts";
import { usableWidth } from "./step-scheduling.ts";
import { STEPS } from "./step-table.mjs";
import { spawnTest } from "./test-wait.ts";

const baseline = () => readBaseline(readFileSync(new URL("./times.tsv", import.meta.url), "utf8"));

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

/** A real runner in a scratch repository running `steps`: `format` never finishes, `records` finishes at once. */
function runFixture(t: { after: (fn: () => void) => void }, steps: string, bounds: Record<string, number>, owned: Record<string, string> = {}) {
  // The run's own TMPDIR inside a gate; the runner's directory sits under the fixture's HOME/.cache.
  const own = mkdtempSync(join(tmpdir(), "step-bound-"));
  t.after(() => { writeFileSync(join(own, "release"), "the test is over"); rmSync(own, { recursive: true, force: true }); });
  const root = join(own, "repo"), gate = join(root, "tooling/gate"), target = join(own, "target"), run = join(own, "home/.cache/gate-run");
  mkdirSync(gate, { recursive: true });
  mkdirSync(join(target, "gate-costs"), { recursive: true });
  const source = fileURLToPath(new URL("./", import.meta.url));
  for (const name of readdirSync(source)) {
    if (name === "run.mjs") writeFileSync(join(gate, name), readFileSync(join(source, name)));
    else if (name === "step-table.mjs") {
      writeFileSync(join(gate, name), `import { STEPS as REAL, stepTableProblem } from ${JSON.stringify(pathToFileURL(join(source, name)).href)};
const bounds = ${JSON.stringify(bounds)};
export const STEPS = REAL.map(row => Object.hasOwn(bounds, row.name) ? { ...row, bound: bounds[row.name] } : row);
export { stepTableProblem };
`);
    } else if (!["all.sh", "times.tsv"].includes(name)) symlinkSync(join(source, name), join(gate, name));
  }
  writeFileSync(join(gate, "times.tsv"), "format\t1\t1\t1\nrecords\t1\t1\t1\n");
  const listed = spawnTest("sh", [join(source, "all.sh"), "--list"], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  writeFileSync(join(gate, "payload.mjs"), `
import { existsSync, watch } from "node:fs";
const own = ${JSON.stringify(own)};
if (process.env.NTS_GATE_STEP === "format") {
  console.log("format waits for a release that comes only after the test");
  await new Promise(resolve => { const watcher = watch(own, () => { if (existsSync(own + "/release")) { watcher.close(); resolve(); } }); });
} else console.log("records finished");
`);
  writeFileSync(join(gate, "all.sh"), `#!/bin/sh
if [ "$1" = --list ]; then
cat <<'NAMES'
${listed.stdout.trim()}
NAMES
else
  exec ${JSON.stringify(process.execPath)} "$(dirname "$0")/payload.mjs"
fi
`);
  // An ample memory reading of its own, as every test that starts a real runner gives it.
  const meminfo = join(own, "meminfo"); writeFileSync(meminfo, "MemAvailable: 64000000 kB\n");
  const planned = gateEnvironment({ ...hostEnvironment(process.env), HOME: join(own, "home") }, { run, owned: {
    NTS_GATE_STEPS: steps, NTS_GATE_SLOTS: "2", NTS_GATE_MEM_GB: "20", NTS_MEMINFO: meminfo, CARGO_TARGET_DIR: target, ...owned,
  } });
  const result = spawnTest(process.execPath, [join(gate, "run.mjs")], { cwd: root, env: planned.env, encoding: "utf8" });
  type Row = { name: string; verdict: string; reason: string; log: string; bound_s: number; bound_basis: string;
    instrument?: { kind: string; verdict: string; reason: string }; scope?: { populated: number } };
  assert.ok(existsSync(join(run, "summary.json")), `the runner wrote no summary (exit ${result.status}):\n${result.stdout}${result.stderr}`);
  const summary = JSON.parse(readFileSync(join(run, "summary.json"), "utf8")) as { verdict: string; steps: Row[]; interrupted: unknown; scope_cleanup: { state: string } };
  const step = (name: string) => summary.steps.find(row => row.name === name)!;
  return { result, summary, format: step("format"), records: step("records") };
}

test("a step past its bound is stopped through its scope and held, its log kept, and the run finishes", t => {
  const { result, summary, format, records } = runFixture(t, "format records", { format: 3 });
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

test("a step within its bound is untouched", t => {
  const { result, summary, records } = runFixture(t, "records", { records: 30 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(summary.verdict, "green");
  assert.equal(records.verdict, "PASS");
  assert.equal(records.reason, "");
  assert.equal(records.instrument, undefined);
  assert.deepEqual([records.bound_s, records.bound_basis], [30, "stated"]);
  assert.equal(readFileSync(records.log, "utf8"), "records finished\n");
});

test("under a landing check's ceiling, a step is stopped there whatever its own bound", t => {
  const { result, format, records } = runFixture(t, "format records", { format: 7200 }, { NTS_GATE_STEP_CEILING_S: "3" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(format.verdict, "INSTRUMENT");
  assert.equal(format.reason, "step exceeded its bound of 3 s");
  assert.deepEqual([format.bound_s, format.bound_basis], [3, "ceiling"]);
  assert.equal(records.verdict, "PASS");
  assert.deepEqual([records.bound_s, records.bound_basis], [3, "ceiling"]);
});
