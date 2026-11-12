import {STEP_CPU_MEASURE,GNU_CPU_MEASURE,readStepBaseline} from '../gate/step-time.ts';
// The landing selection: what runs before a change lands, and its estimate.
//
//   node --test tooling/landing/selection.test.ts
//
// The changed paths here are made up: owed.mjs reads a tooling test for the
// repository paths it names and charges those paths the tooling step, so a
// real compiler source named here would make every compiler change owe it.
// A path inside a crate's directory gets that crate's rules, real or not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allSteps, gateSteps, inCorpus, LANDING, owed } from "../gate/owed.mjs";
import { STEPS } from "../gate/step-table.mjs";
import {
  landingCpuMeasure,costKey, costLookup, deferredSteps, describeSelection, landingSelection, landingSteps, machineBudget, owedReach, readBaseline,
  readLandingCosts, recompilesRust, stepSeconds, type Owed, type SelectionInput, type StepCost, type StepRow, type Table,
} from "./selection.ts";

const budget = machineBudget(32); // 24 slots, as the gate sizes itself on this machine
const rows = new Map<string, StepRow>((STEPS as StepRow[]).map(row => [row.name, row]));
const table = LANDING as Table;
const catalogue: string[] = allSteps();
const measured = (cpu: number, wall?: number): StepCost => ({ cpu, ...(wall ? { wall } : {}), measured: true, source: "fixture" });

/** A full core gate's CPU per step (seconds), as one measured on 2026-11-06. */
const HISTORY: Record<string, number> = {
  build: 60, clippy: 96, tests: 4200, doctests: 3, tooling: 550, test262: 2, rustfmt: 6, format: 4, reformat: 1, records: 1,
  "old-paths": 3, primitives: 1, config: 4, licenses: 1, audit: 1, outcomes: 260, blockers: 800, examples: 1810, llvm: 1829,
  "llvm-rc": 1802, jvm: 1814, rc: 1788, "expect-ir": 7, "example-refusals": 66, benches: 53, memory: 71,
};
const fromHistory = (extra: Record<string, StepCost> = {}) => (step: string): StepCost =>
  extra[step] ?? (HISTORY[step] ? measured(HISTORY[step]!) : { cpu: 60, measured: false, source: "default" });

function select(steps: string[] | "all", paths: string[], overrides: Partial<SelectionInput> = {}) {
  return landingSelection({ owed: { steps }, paths, catalogue, table, inCorpus, rows, cost: fromHistory(), budget, ...overrides });
}
const names = (s: { landing: { step: string }[] }) => s.landing.map(l => l.step).sort();
const why = (s: { deferred: { step: string; why: string }[] }, step: string) => s.deferred.find(d => d.step === step)?.why;

test("a docs-only change runs its tree checks and nothing else", () => {
  const s = select(["records", "primitives"], ["docs/landing-example.md"]);
  assert.deepEqual(names(s), ["primitives", "records"]);
  assert.deepEqual(s.deferred, []);
  assert.ok(s.fits);
  assert.ok(s.estimate.seconds < 10, `${s.estimate.seconds}`);
});

test("a compiler change runs build, lint, tests and the tree checks; its suites run after landing", () => {
  const owed = ["build", "clippy", "tests", "rustfmt", "old-paths", "examples", "llvm", "outcomes", "blockers", "integrity",
    "typescript-c", "typescript-llvm", "test262-cases", "compile-time"];
  const s = select(owed, ["compiler/core/src/landing-example.rs"]);
  assert.deepEqual(names(s), ["build", "clippy", "old-paths", "rustfmt", "tests"]);
  assert.equal(why(s, "examples"), "not its own fixtures");
  assert.equal(why(s, "blockers"), "not its own fixtures");
  assert.equal(why(s, "typescript-c"), "sample not built yet");
  assert.equal(why(s, "test262-cases"), "sample not built yet");
  assert.equal(why(s, "integrity"), "after landing");
  assert.equal(why(s, "compile-time"), "after landing");
  assert.deepEqual(deferredSteps(s).sort(), owed.filter(step => !names(s).includes(step)).sort());
  assert.deepEqual(landingSteps(s)[0], "build");
});

test("a fixture is checked by its own steps before it lands, on every backend", () => {
  const owedSteps = ["build", "clippy", "tests", "rustfmt", "old-paths", "outcomes", "integrity", "jvm-verifies"];
  const s = select(owedSteps, ["tests/outcomes/a-new-defect/src/main.ts", "tests/outcomes/a-new-defect/outcome.json"]);
  assert.ok(names(s).includes("outcomes"));
  assert.equal(why(s, "integrity"), "after landing");
  const program = select(["build", "clippy", "tests", "examples", "llvm", "llvm-rc", "jvm", "rc", "expect-ir", "example-refusals", "integrity", "dex"],
    ["tests/programs/new-case/src/main.ts", "tests/programs/new-case/tsconfig.json"]);
  for (const step of ["examples", "llvm", "llvm-rc", "jvm", "rc", "expect-ir", "example-refusals"]) assert.ok(names(program).includes(step), step);
  assert.equal(why(program, "dex"), "after landing");
});

test("a selection over the budget moves its costliest movable steps, and never the fixed ones", () => {
  // Every backend's agreement beside a long test run: too much work for ten minutes.
  const heavy = fromHistory({ examples: measured(6000), llvm: measured(6000), jvm: measured(6000), tests: measured(2400) });
  const s = select(["build", "clippy", "tests", "examples", "llvm", "jvm", "rc"], ["tests/programs/x/src/main.ts"], { cost: heavy });
  assert.ok(s.fits, describeSelection(s));
  for (const step of ["build", "clippy", "tests"]) assert.ok(names(s).includes(step), step);
  const moved = s.deferred.filter(d => d.why === "over the budget").map(d => d.step);
  assert.ok(moved.length >= 1 && moved.every(step => ["examples", "llvm", "jvm"].includes(step)), moved.join(" "));
  assert.ok(names(s).includes("rc"), "the cheap step that fits stays");
});

test("a step that runs in the shadow of a longer fixed one stays, and the overrun is named", () => {
  // tests alone exceed the budget: moving the fixture steps would not shorten the landing.
  const long = fromHistory({ tests: measured(9600) });
  const s = select(["build", "tests", "outcomes"], ["tests/outcomes/x/src/main.ts"], { cost: long });
  assert.equal(s.fits, false);
  assert.ok(names(s).includes("outcomes"));
  assert.equal(s.estimate.longestStep, "tests");
  assert.ok(Math.abs(s.estimate.fixed - s.estimate.seconds) < 1e-9);
  assert.match(describeSelection(s), /over the budget: the steps that never move take/);
});

test("the TypeScript and test262 steps run as one sample each once all.sh has them", () => {
  const sampled = [...catalogue, "typescript-sample", "test262-sample"];
  const s = select(["build", "tests", "typescript-c", "typescript-llvm", "typescript-jvm", "test262-cases", "test262-jvm"],
    ["compiler/core/src/landing-example.rs"], { catalogue: sampled });
  const sample = s.landing.find(l => l.step === "typescript-sample");
  assert.deepEqual(sample?.for, ["typescript-c", "typescript-llvm", "typescript-jvm"]);
  assert.deepEqual(s.landing.find(l => l.step === "test262-sample")?.for, ["test262-cases", "test262-jvm"]);
  assert.equal(why(s, "typescript-c"), undefined);
  // Moved over the budget, a sample defers the owed steps it stood for.
  const over = select(["build", "tests", "typescript-c", "typescript-jvm"], ["compiler/core/src/landing-example.rs"],
    { catalogue: sampled, cost: fromHistory({ "typescript-sample": measured(20000), tests: measured(100) }) });
  assert.deepEqual(over.deferred.filter(d => d.why === "over the budget").map(d => d.step), ["typescript-c", "typescript-jvm"]);
});

test("a prerequisite runs with every step that needs it, and moves with them", () => {
  const withOracles = new Map(rows);
  withOracles.set("typescript-sample", { name: "typescript-sample", slots: 8, fe: true, needs: ["typescript-oracles"] });
  withOracles.set("typescript-oracles", { name: "typescript-oracles", slots: 8, fe: true });
  const sampled = [...catalogue, "typescript-sample", "typescript-oracles"];
  const oraclesTable: Table = { ...table, "typescript-oracles": { form: "sample", sample: "typescript-sample" } };
  const base = { catalogue: sampled, rows: withOracles, table: oraclesTable };
  const s = select(["build", "tests", "typescript-c", "typescript-oracles"], ["compiler/core/src/landing-example.rs"], base);
  assert.ok(names(s).includes("typescript-sample") && names(s).includes("typescript-oracles"), names(s).join(" "));
  assert.equal(s.landing.find(l => l.step === "typescript-oracles")?.form, "prerequisite");
  // Too costly: the prerequisite leaves with the sample, and the owed steps say why.
  const heavy = select(["build", "tests", "typescript-c", "typescript-oracles"], ["compiler/core/src/landing-example.rs"],
    { ...base, cost: fromHistory({ "typescript-oracles": measured(30000), tests: measured(100) }) });
  assert.ok(!names(heavy).includes("typescript-oracles") && !names(heavy).includes("typescript-sample"), names(heavy).join(" "));
  assert.equal(why(heavy, "typescript-c"), "over the budget");
  assert.equal(why(heavy, "typescript-oracles"), "over the budget");
  // Needed by a step that never moves, a prerequisite never moves either.
  const pinned = new Map(withOracles);
  pinned.set("tests", { ...rows.get("tests")!, needs: ["typescript-oracles"] });
  const fixed = select(["build", "tests"], ["compiler/core/src/landing-example.rs"],
    { ...base, rows: pinned, cost: fromHistory({ "typescript-oracles": measured(30000) }) });
  assert.ok(names(fixed).includes("typescript-oracles"));
  assert.equal(fixed.fits, false);
});

test("an owed step its form defers still runs when a landing step needs it", () => {
  const needy = new Map(rows);
  needy.set("outcomes", { ...rows.get("outcomes")!, needs: ["integrity"] });
  const s = select(["build", "outcomes", "integrity"], ["tests/outcomes/x/src/main.ts"], { rows: needy });
  assert.ok(names(s).includes("integrity"));
  assert.equal(why(s, "integrity"), undefined);
});

test("a landing step whose prerequisite all.sh does not define is refused, never run without it", () => {
  const needy = new Map(rows);
  needy.set("outcomes", { ...rows.get("outcomes")!, needs: ["outcome-oracles"] });
  assert.throws(() => select(["build", "outcomes"], ["tests/outcomes/x/src/main.ts"], { rows: needy }),
    /outcomes needs outcome-oracles, which all\.sh does not define/);
  // A step that does not land does not need its prerequisite to exist yet.
  assert.doesNotThrow(() => select(["build", "outcomes"], ["compiler/core/src/landing-example.rs"], { rows: needy }));
});

test("a step's seconds are its CPU over its granted width, or its measured parallelism when more", () => {
  const tests = rows.get("tests")!; // eight slots; each test binary runs threads of its own
  assert.equal(stepSeconds(measured(4800), tests, budget), 600);
  assert.ok(Math.abs(stepSeconds(measured(4800, 300), tests, budget) - 300) < 1e-9, "sixteen cores reached on eight slots");
  assert.equal(stepSeconds(measured(4800, 2000), tests, budget), 600, "a contended run does not narrow the granted width");
  assert.equal(stepSeconds(measured(100, 1), tests, budget), 100 / 24, "never wider than the run");
  const frontends = { ...budget, frontends: 2 };
  assert.equal(stepSeconds(measured(800), rows.get("examples")!, frontends), 400, "the frontend cap narrows a frontend step");
});

test("measured by the landing check, a step's width is the parallelism it reached there", () => {
  // A warm compiler change on this machine: the incremental build reached 3.6 of its 8 slots.
  const build: StepCost = { cpu: 111, wall: 31, measured: true, source: "landing" };
  assert.equal(stepSeconds(build, rows.get("build")!, budget), 31);
  assert.equal(stepSeconds({ ...build, source: "baseline" }, rows.get("build")!, budget), 111 / 8, "a full gate's measurement keeps the granted width");
  assert.equal(stepSeconds({ cpu: 0, wall: 1, measured: true, source: "landing" }, rows.get("build")!, budget), 0);
});

test("the estimate is the build, then the work or the longest step, whichever is longer", () => {
  const s = select(["build", "clippy", "tests"], ["compiler/core/src/landing-example.rs"],
    { cost: fromHistory({ build: measured(800), clippy: measured(600), tests: measured(4000) }) });
  assert.equal(s.estimate.build, 800 / 8);
  assert.equal(s.estimate.work, 4600 / 24);
  assert.equal(s.estimate.longest, 4000 / 8);
  assert.equal(s.estimate.seconds, 100 + 500);
});

test("recorded costs: the landing check's own by kind of change, then the baseline, then a minute at full width", t => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "landing-costs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "costs.json");
  writeFileSync(file, JSON.stringify({ version: 2, steps: {
    "build:rust": { cpu: 700, wall: 120,cpu_measure:GNU_CPU_MEASURE }, "build:other": { cpu: 4,cpu_measure:GNU_CPU_MEASURE }, tooling: { cpu: 500, wall: 240,cpu_measure:STEP_CPU_MEASURE },legacy:{cpu:0.1,cpu_measure:GNU_CPU_MEASURE},
    "tests:nonsense": { cpu: 1 }, bogus: { cpu: -1 },
  } }));
  const own = readLandingCosts(file);
  assert.deepEqual([...own.keys()].sort(), ["build:other", "build:rust", "tooling"]);
  const baseline = readBaseline(`# step\twall\tcpu\tslots\ntests\t219.1\t3253.8\t8\t${STEP_CPU_MEASURE}\nclippy\t0.3\t0.2\t6\t${STEP_CPU_MEASURE}\nbad\tx\ty\t1\n`);
  const rust = costLookup(own, baseline, "rust", rows, budget), other = costLookup(own, baseline, "other", rows, budget);
  assert.equal(rust("build").cpu, 700);
  assert.equal(other("build").cpu, 4);
  assert.equal(rust("tests").source, "baseline");
  assert.equal(rust("tests").cpu, 3253.8);
  assert.equal(rust("tooling").source, "landing");
  assert.deepEqual(rust("examples"), { cpu: 60 * 8, measured: false, source: "default" });
  assert.equal(costKey("tests", "rust"), "tests:rust");
  assert.equal(costKey("examples", "rust"), "examples");
  assert.deepEqual([...readLandingCosts(join(dir, "missing.json"))], []);
  writeFileSync(file, "{not json");
  assert.deepEqual([...readLandingCosts(file)], []);
  // The committed baseline parses.
  const committed=readFileSync(new URL("../gate/times.tsv",import.meta.url),'utf8');
  for(const [name,row] of readStepBaseline(committed))assert.equal(readBaseline(committed).has(name),row.cpu_measure===landingCpuMeasure(name));
  assert.equal(readBaseline('tests\t2\t0.1\t1\n').size,0,'a legacy CPU baseline cannot estimate cgroup work');
});

test("a change recompiles Rust when it touches a crate, a Rust source, the lock or a vendored source", () => {
  const inCrate = (path: string) => path.startsWith("compiler/");
  assert.ok(recompilesRust(["compiler/core/src/landing-example.rs"], inCrate));
  assert.ok(recompilesRust(["Cargo.lock"], inCrate));
  assert.ok(recompilesRust(["third_party/tsrs/crates/x/src/lib.rs"], inCrate));
  assert.ok(!recompilesRust(["docs/landing-example.md", "tooling/landing/check.ts", "tests/programs/a/src/main.ts"], inCrate));
});

test("the rules and the table together: docs, a tool and the compiler's core", () => {
  const owes = (path: string): Owed => { const rules = owed([{ path, added: false }]); return { steps: gateSteps(rules), reach: owedReach(rules, catalogue) }; };
  const docs = landingSelection({ owed: owes("docs/landing-example.md"), paths: ["docs/landing-example.md"], catalogue, table, inCorpus, rows, cost: fromHistory(), budget });
  assert.ok(docs.landing.every(l => l.form === "tree"), describeSelection(docs));
  const tool = landingSelection({ owed: owes("tooling/landing/queue.ts"), paths: ["tooling/landing/queue.ts"], catalogue, table, inCorpus, rows, cost: fromHistory(), budget });
  assert.deepEqual(names(tool), ["build", "clippy", "old-paths", "rustfmt", "test-host", "tests", "tooling", "tooling-types"]);
  // The core reaches the CLI and the suite through the crate graph, which add
  // their seconds-long checks (config, test262); its suites run after landing.
  const core = landingSelection({ owed: owes("compiler/core/src/landing-example.rs"), paths: ["compiler/core/src/landing-example.rs"], catalogue, table, inCorpus, rows, cost: fromHistory(), budget });
  for (const step of ["build", "clippy", "tests", "rustfmt"]) assert.ok(names(core).includes(step), step);
  assert.ok(core.landing.every(l => l.form === "tree" || l.form === "as-is"), describeSelection(core));
  for (const step of ["examples", "llvm", "jvm", "rc", "blockers", "integrity", "typescript-c", "test262-cases", "compile-time"]) assert.ok(deferredSteps(core).includes(step), step);
});
