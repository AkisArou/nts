// node --test tooling/full-check/service.test.ts
//
// The loop over a scratch repository with a local bare origin and a stand-in
// gate (repository-fixture.ts): it takes the newest main, moves and pushes
// verified on a green core only, reverts the first red commit and submits the
// revert first, and records after a green run that listed pending cases, in a
// records unit beside the core (stand-in units): the rows land on main as it
// is once the unit ends, and a refused records commit is applied again on the
// newest main until it lands or its attempts run out.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {test} from "node:test";
import {applyEveryRow, assertMessage, checkoutIn, ENV, fakeGate, recording, repository, stubBench, stubQueue, stubUnits, type FakeGate, type Repository, type StubQueue, type StubUnits} from "./repository-fixture.ts";
import type { Applier, Recorder } from "./records.ts";
import {BENCH_ASK_AGAIN_MS, BENCH_INTERRUPTIONS, countOnce, cycle, followVerified, fullCheckStatus, parseOptions, partSteps, RECORDER_LOG, recordJob, recordingPins, recordPending, RECORDS_ATTEMPTS, RECORDS_OUTCOME, RECORDS_UNIT_LOG, recordsUnit, statusText, type CountEffects, type Effects} from "./service.ts";
import {DELTA_FILE} from "../records/delta.ts";
import {reopenIssue, type Gh} from "./revert.ts";
import {readCount, readState, type CountRecord, type Part} from "./state.ts";
import {recordsUnitName} from "./unit.ts";
import {GateResource} from "../gate/gate-resource.ts";
import {Git} from "./git.ts";
import {candidateEnvironmentFixture,candidateVersion,resolutionSubject,assertSessionClosed} from './run-environment-fixture.ts';
import {hostEnvironment} from '../gate/canonical-environment.ts';
import {nodeInstallation} from '../gate/toolchain-fixture.ts';

type Harness = Effects & {
  lines: string[]; queue: StubQueue; submitted: StubQueue["submitted"]; withdrawn: string[]; told: { n: number; comment: string }[]; units: StubUnits;
  /** What the records units do in place of record-pending.ts (recordIn). */
  recorder: Recorder;
};

function harness(repo: Repository, gate: FakeGate, options: { now?: Date; recorder?: Recorder; applier?: Applier; queue?: StubQueue; units?: StubUnits; schedule?: Effects["schedule"]; bench?: Effects["bench"]; issue?: Effects["issue"] } = {}): Harness {
  const lines: string[] = [], told: { n: number; comment: string }[] = [];
  const queue = options.queue ?? stubQueue();
  return {
    layout: repo.layout,
    git: repo.git,
    gate,
    queue,
    submitted: queue.submitted,
    withdrawn: queue.withdrawn,
    units: options.units ?? stubUnits(),
    node: () => process.execPath,
    recorder: options.recorder ?? (() => ({ status: 0, output: "" })),
    checkout: (tree, commit) => checkoutIn(repo, tree)(commit),
    applier: options.applier ?? applyEveryRow,
    bench: options.bench ?? stubBench(),
    pins: join(repo.root, "pins"),
    push: commit => {
      const r = repo.git.try(["push", "-q", "origin", `${commit}:refs/heads/verified`]);
      return { ok: r.status === 0, line: r.status === 0 ? `pushed ${commit}` : r.stderr };
    },
    issue: (n, comment) => { told.push({ n, comment }); return options.issue?.(n, comment) ?? { ok: true, line: `issue #${n} is open again` }; },
    now: () => options.now ?? new Date(2026, 10, 6, 12, 0),
    log: line => lines.push(line),
    schedule: options.schedule ?? { wide: ["10:00"], nightly: "03:00" },
    lines,
    told,
  };
}

/**
 * The part's records unit ends, having done what its command line says: the
 * records job its tree's own code runs (service.ts --record), with the
 * harness's recorder in place of record-pending.ts.
 */
function recordIn(fx: Harness, part: Part = "core"): void {
  fx.units.finish(recordsUnitName(part), spec => {
    const job = parseOptions(spec.command.slice(2)).record;
    assert.ok(job, spec.command.join(" "));
    recordJob(spec.cwd, job, fx.recorder);
  });
}

/** The part's records unit ends, and the next cycle applies what it recorded on main and submits it. */
async function recordAndApply(fx: Harness, part: Part = "core"): Promise<void> {
  recordIn(fx, part);
  assert.equal(await cycle(fx), "records", fx.lines.join("\n"));
}

const remoteVerified = (repo: Repository) => repo.git.run(["ls-remote", "origin", "refs/heads/verified"]).split("\t")[0] || null;
const verified = (repo: Repository) => repo.git.commit("refs/heads/verified");

test("the core runs on the newest main, and verified moves and is pushed on green only", async t => {
  const repo = repository(t);
  const first = repo.commit({ "a.txt": "1\n" }, "first");
  const gate = fakeGate(repo);
  const fx = harness(repo, gate);

  assert.equal(await cycle(fx), "core");
  assert.deepEqual(gate.measured.map(m => m.commit), [first]);
  assert.deepEqual(gate.measured[0]!.steps, ["build", "tests", "typescript-c"], "the core is every step but the wide ones");
  assert.equal(verified(repo), first);
  assert.equal(remoteVerified(repo), first);

  repo.commit({ "a.txt": "2\n" }, "second");
  const third = repo.commit({ "a.txt": "3\n" }, "third");
  assert.equal(await cycle(fx), "core");
  assert.equal(gate.measured.at(-1)!.commit, third, "the newest main, not every commit");
  assert.equal(verified(repo), third);
  assert.equal(remoteVerified(repo), third);

  // Nothing new on main: no run, and the count is its own timer's.
  assert.equal(await cycle(fx), "idle");
  assert.equal(gate.measured.length, 2);

  // A step that could not finish holds: verified stays.
  const held = repo.commit({ "HELD/tests": "" }, "held");
  assert.equal(await cycle(fx), "core");
  assert.equal(readState(repo.layout.state).core.last_run?.verdict, "held");
  assert.equal(verified(repo), third);

  // A red run moves nothing either.
  repo.commit({ "HELD/tests": null, "RED/typescript-c": "" }, "red");
  await cycle(fx);
  assert.equal(verified(repo), third);
  assert.equal(remoteVerified(repo), third);
  assert.ok(gate.measured.some(m => m.commit === held));
});

/** After a green commit: a -> b (breaks typescript-c) -> c -> d. */
function redHistory(repo: Repository) {
  const a = repo.commit({ "a.txt": "a\n" }, "a: harmless");
  const b = repo.commit({ "RED/typescript-c": "", "b.txt": "b\n" }, "b: breaks typescript-c");
  const c = repo.commit({ "c.txt": "c\n" }, "c: harmless");
  const d = repo.commit({ "d.txt": "d\n" }, "d: harmless");
  return { a, b, c, d };
}

test("a red core is searched, and the first red commit's revert is made on main and submitted first", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const fx = harness(repo, gate);
  const good = repo.commit({ "src.txt": "base\n" }, "good");
  await cycle(fx);
  assert.equal(verified(repo), good);
  const { b, d } = redHistory(repo);

  await cycle(fx);
  const state = readState(repo.layout.state);
  assert.equal(state.core.last_run?.verdict, "red");
  assert.deepEqual(state.core.last_run?.failed, ["typescript-c"]);
  assert.equal(verified(repo), good, "a red core does not move verified");
  assert.deepEqual(state.culprits.map(c => c.commit), [b]);
  const revert = state.culprits[0]!.revert!;
  assert.ok(revert);
  assert.deepEqual(fx.submitted, [{ commit: revert, first: true }], "the revert goes to the queue first");
  assert.equal(repo.git.run(["rev-parse", `${revert}^`]), d, "made on the newest main");
  assert.equal(repo.git.commit(`refs/full-check/reverts/${b.slice(0, 12)}`), revert, "kept reachable until it lands");
  assertMessage(repo.git, revert, /^Revert "b: breaks typescript-c"/, new RegExp(`This reverts commit ${b}\\.`), /typescript-c/, new RegExp(`Full-check-run: ${state.core.last_run!.run}`));
  assert.equal(repo.git.run(["ls-tree", "-r", "--name-only", revert, "--", "RED/"]), "", "the revert takes the culprit's change out");
  assert.ok(fx.lines.some(line => line.startsWith("TASK for an issue: - Land ") && line.includes(b.slice(0, 12)) && line.includes("typescript-c")), fx.lines.join("\n"));
  // The tip and the last green commit measured again, two bisection probes
  // for four candidates, and the culprit measured again.
  const searched = gate.measured.filter(m => m.label === "core-probe").length;
  assert.equal(searched, 5, `probes: ${searched}`);
  assert.ok(gate.measured.some(m => m.label === "core-probe" && m.commit === good), "the last green commit is the control");

  // Main moves on while the revert waits in the queue: the red is explained
  // by the pending revert, and nothing is submitted twice.
  const e = repo.commit({ "e.txt": "e\n" }, "e: harmless");
  await cycle(fx);
  assert.equal(fx.submitted.length, 1);
  assert.ok(fx.lines.some(line => line.includes(`red at ${e.slice(0, 12)} is explained`)), fx.lines.join("\n"));

  // The revert lands (rebased onto main by the landing check): green again,
  // verified moves, and the ref that kept the revert goes.
  repo.git.run(["cherry-pick", revert]);
  const landed = repo.git.run(["rev-parse", "HEAD"]);
  await cycle(fx);
  assert.equal(verified(repo), landed);
  assert.equal(repo.git.commit(`refs/full-check/reverts/${b.slice(0, 12)}`), null);
});

test("one culprit does not hide another: a reverted culprit is taken out of the commits before its revert", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const fx = harness(repo, gate);
  const good = repo.commit({ "src.txt": "base\n" }, "good");
  await cycle(fx);
  const a = repo.commit({ "RED/tests": "" }, "a: breaks tests");
  repo.commit({ "b.txt": "b\n" }, "b: harmless");
  const c = repo.commit({ "RED/tests.again": "" }, "c: breaks tests again");
  repo.commit({ "d.txt": "d\n" }, "d: harmless");
  await cycle(fx);
  assert.deepEqual(readState(repo.layout.state).culprits.map(x => x.commit), [a], "the first red commit first");

  // a's revert lands; tests is still red, now because of c, which a hid.
  repo.git.run(["cherry-pick", fx.submitted[0]!.commit]);
  await cycle(fx);
  const state = readState(repo.layout.state);
  assert.equal(state.core.last_green?.commit, good);
  assert.deepEqual(state.culprits.map(x => x.commit), [a, c]);
  assert.equal(fx.submitted.length, 2);
  assert.ok(gate.measured.some(m => m.label === "core-probe" && repo.git.run(["log", "-1", "--format=%s", m.commit]).startsWith("full check: ")),
    "candidates before the revert are measured with a taken out");
});

test("a red that does not repeat is reported as flaky and nothing is reverted", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo, { flaky: ["tests"] });
  const fx = harness(repo, gate);
  // The first run is the flaky one: give the search a green run to start from.
  const gateOk = fakeGate(repo);
  const ok = harness(repo, gateOk);
  repo.commit({ "src.txt": "base\n" }, "good");
  await cycle(ok);
  repo.commit({ "x.txt": "x\n" }, "x");
  await cycle(fx);
  assert.equal(fx.submitted.length, 0);
  assert.equal(readState(repo.layout.state).culprits.length, 0);
  assert.ok(fx.lines.some(line => line.includes("TASK") && line.includes("flaky")), fx.lines.join("\n"));
});

test("a search that could not finish is taken up again half an hour later, keeping what it measured", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  let clock = new Date(2026, 10, 6, 12, 0);
  const fx = harness(repo, gate);
  fx.now = () => clock;
  repo.commit({ "src.txt": "base\n" }, "good");
  await cycle(fx);
  const { b } = redHistory(repo);
  // The tip's second measurement cannot finish (memory, say): the search holds.
  const run = gate.run.bind(gate);
  let calls = 0;
  gate.run = (commit, steps, label) => {
    const m = run(commit, steps, label);
    if (++calls !== 2) return m;
    const held = Object.fromEntries(steps.map(step => [step, "HELD" as const]));
    return { ...m, steps: held, reasons: Object.fromEntries(steps.map(step => [step, "INSTRUMENT: memory"])), verdict: "held" };
  };
  await cycle(fx);
  assert.match(readState(repo.layout.state).core.last_run?.search?.result ?? "", /^held: the tip could not be measured again/);
  assert.equal(fx.submitted.length, 0);
  clock = new Date(clock.getTime() + 10 * 60_000);
  assert.equal(await cycle(fx), "idle", "not yet");
  clock = new Date(clock.getTime() + 25 * 60_000);
  assert.equal(await cycle(fx), "core");
  const state = readState(repo.layout.state);
  assert.equal(state.core.last_run?.search?.result, `culprit ${b.slice(0, 12)}`);
  assert.equal(fx.submitted.length, 1);
});

test("a red with no green run to search from is a task, not a revert", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const fx = harness(repo, gate);
  repo.commit({ "RED/build": "" }, "broken from the start");
  await cycle(fx);
  assert.equal(fx.submitted.length, 0);
  assert.ok(fx.lines.some(line => line.includes("TASK") && line.includes("no green run to search from")));
});

test("a revert that does not apply to main becomes a task", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const fx = harness(repo, gate);
  repo.commit({ "src.txt": "base\n" }, "good");
  await cycle(fx);
  const culprit = repo.commit({ "RED/tests": "", "src.txt": "changed by the culprit\n" }, "culprit");
  repo.commit({ "src.txt": "changed again on top\n" }, "builds on it");
  await cycle(fx);
  const state = readState(repo.layout.state);
  assert.deepEqual(state.culprits.map(c => [c.commit, c.revert]), [[culprit, null]]);
  assert.equal(fx.submitted.length, 0);
  assert.ok(fx.lines.some(line => line.includes("TASK") && line.includes("revert it by hand")), fx.lines.join("\n"));
});

test("a culprit whose revert does not apply stays in where it cannot be taken out, and the next red is still searched", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  // Before every slot: only the core runs, so the wide part is never green
  // after the first culprit and it stays pending.
  const fx = harness(repo, gate, { now: new Date(2026, 10, 6, 2, 0) });
  repo.commit({ "src.txt": "base\n" }, "good");
  await cycle(fx);
  const first = repo.commit({ "RED/tests": "", "src.txt": "changed by the culprit\n" }, "culprit");
  repo.commit({ "src.txt": "changed again on top\n" }, "builds on it");
  await cycle(fx);
  assert.deepEqual(readState(repo.layout.state).culprits.map(c => [c.commit, c.revert]), [[first, null]]);
  // Fixed forward rather than reverted, and before any green run another
  // commit breaks another step: the search spans the first culprit, whose
  // revert cannot be taken out of the tip, and still finds the second.
  repo.commit({ "RED/tests": null }, "fixed forward");
  const second = repo.commit({ "RED/typescript-c": "" }, "breaks typescript-c");
  await cycle(fx);
  const state = readState(repo.layout.state);
  assert.deepEqual(state.culprits.map(c => c.commit), [first, second]);
  assert.ok(fx.lines.some(line => line.startsWith("measuring ") && line.includes(`with ${first.slice(0, 12)} in: the revert of ${first.slice(0, 12)} does not apply`)), fx.lines.join("\n"));
  assert.ok(!fx.lines.some(line => line.startsWith("culprit search held")), fx.lines.join("\n"));
});

test("a green run that listed pending cases records them, commits exactly the records on main and submits the commit", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const recorder = recording({ "results/oracle-counts/tests/programs/new-case.json": "{\"cases\": 3}\n" }, (tree, pin, run, part) => {
    assert.equal(part, "core", "the core's green run records the core's kinds");
    assert.ok(existsSync(pin), "the recorder runs with the run's pin");
    writeFileSync(join(tree, "scratch-output.txt"), "not a record\n");
    writeFileSync(join(run, RECORDER_LOG), "record-pending: 1 row(s) recorded\n");
    return { status: 0, output: "" };
  });
  const fx = harness(repo, gate, { recorder });
  const commit = repo.commit({ "LOG/typescript-c": "  pending: tests/programs/new-case is not recorded in results/oracle-counts/tests/programs/new-case.json yet\n" }, "a new case");
  assert.equal(await cycle(fx), "core");
  assert.ok(fx.units.running(recordsUnitName("core")), "the core's green run starts the core's records unit");
  assert.equal(readState(repo.layout.state).core.records?.submitted, null, "nothing lands before it ends");
  await recordAndApply(fx);
  const state = readState(repo.layout.state);
  assert.equal(state.core.last_green?.commit, commit);
  assert.deepEqual(state.core.last_green?.listed, { pending: 1, accepted: 0 }, "the green run keeps what its checks listed");
  assert.equal(state.core.records?.commit, commit);
  assert.equal(state.wide.records, undefined, "the wide part records only after its own green run");
  const records = state.core.records!.submitted!;
  assert.ok(records, state.core.records?.result);
  assert.deepEqual(fx.submitted, [{ commit: records, first: false }]);
  assert.equal(repo.git.run(["rev-parse", `${records}^`]), commit);
  assert.deepEqual(repo.git.run(["diff", "--name-only", commit, records]).split("\n"), ["results/oracle-counts/tests/programs/new-case.json"], "only what the recorder wrote under the records");
  assertMessage(repo.git, records, /^records: the pending and accepted rows at /, /--apply\nmerged their delta case by case on main /, /1 row\(s\) applied, 0 already recorded, 0 skipped/);
  assert.ok(fx.lines.some(line => line.includes("TASK") && line.includes("scratch-output.txt")), "what it wrote elsewhere is named");
  assert.deepEqual([state.core.records?.delta, state.core.records?.attempts, state.core.records?.base, state.core.records?.settled],
    [join(state.core.last_green!.run, DELTA_FILE), 1, commit, undefined], "the delta, kept in the run's folder, is followed until it lands");
  const pin = join(repo.root, "pins", commit.slice(0, 12));
  assert.equal(JSON.parse(readFileSync(join(pin, "provenance.json"), "utf8")).sha, commit);

  // The same verified commit is never recorded twice.
  await cycle(fx);
  assert.equal(fx.submitted.length, 1);

  // The landing check lands it, rebased: its ref goes.
  const ref = `refs/full-check/records/${commit.slice(0, 12)}`;
  assert.equal(repo.git.commit(ref), records);
  repo.commit({ "unrelated.txt": "x\n" }, "another landing");
  repo.git.run(["cherry-pick", records]);
  await cycle(fx);
  assert.equal(repo.git.commit(ref), null);
});

const NEW_CASE = { "LOG/typescript-c": "  pending: tests/programs/new-case is not recorded in results/oracle-counts/tests/programs/new-case.json yet\n" };
const newCase = () => recording({ "results/oracle-counts/tests/programs/new-case.json": "{\"cases\": 3}\n" });
const answer = (state: "landed" | "refused" | "held", message: string, tip?: string) => ({ state, at: "2026-11-06T12:00:00.000Z", message, ...(tip ? { tip } : {}) });

test("rows recorded at a commit land as a records commit on main as it is when they are applied", async t => {
  const repo = repository(t);
  let landed = "";
  // A records run takes hours, and main moves on while it runs, in the same records.
  const recorder = recording({ "results/oracle-counts/tests/programs/new-case.json": "{\"cases\": 3}\n" }, () => {
    landed = repo.commit({ "results/oracle-counts/tests/programs/other.json": "{\"cases\": 1}\n", "elsewhere.txt": "x\n" }, "landed while the records ran");
    return { status: 0, output: "" };
  });
  const fx = harness(repo, fakeGate(repo), { recorder });
  const commit = repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(fx), "core");
  await recordAndApply(fx);
  const records = readState(repo.layout.state).core.records!;
  assert.equal(records.commit, commit);
  assert.equal(repo.git.run(["rev-parse", `${records.submitted}^`]), landed, "its parent is main, not the commit its rows were recorded at");
  assert.deepEqual(repo.git.run(["diff", "--name-only", landed, records.submitted!]).split("\n"), ["results/oracle-counts/tests/programs/new-case.json"]);
  assert.deepEqual([records.base, records.attempts], [landed, 1]);
});

test("a records commit the landing check refused is applied again on the newest main and submitted; a landed one is settled", async t => {
  const repo = repository(t);
  const fx = harness(repo, fakeGate(repo), { recorder: newCase() });
  const commit = repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(fx), "core");
  await recordAndApply(fx);
  const first = readState(repo.layout.state).core.records!.submitted!;
  // Refused as 4815f13f5 was, for a conflict with a commit that landed first.
  fx.queue.answers.set(first, answer("refused", `${first.slice(0, 12)} conflicts with main in results/benchmarks/c/outcomes.tsv`));
  assert.equal(await cycle(fx), "idle", "on the main it was made on, the same rows would be refused the same way");
  assert.equal(fx.submitted.length, 1);
  const moved = repo.commit({ "elsewhere.txt": "x\n" }, "main moves on");
  assert.equal(await cycle(fx), "records", "applied again first, before the core takes the new main");
  const again = readState(repo.layout.state).core.records!;
  assert.deepEqual([again.attempts, again.base, again.answer, again.settled], [2, moved, undefined, undefined]);
  assert.equal(repo.git.run(["rev-parse", `${again.submitted}^`]), moved, "made on the newest main");
  assert.deepEqual(fx.submitted.map(one => one.commit), [first, again.submitted]);
  assert.equal(repo.git.commit(`refs/full-check/records/${commit.slice(0, 12)}`), again.submitted, "kept reachable until it lands");
  assert.ok(fx.lines.some(line => line.includes(`refused: ${first.slice(0, 12)} conflicts with main`) && line.includes(`applied again on main ${moved.slice(0, 12)}`)), fx.lines.join("\n"));
  // While those rows wait, the core's next green run does not record them a second time.
  assert.equal(await cycle(fx), "core");
  assert.equal(fx.submitted.length, 2);
  assert.ok(fx.lines.some(line => line.includes(`the core rows recorded at ${commit.slice(0, 12)} still wait for the landing check`)), fx.lines.join("\n"));
  fx.queue.answers.set(again.submitted!, answer("landed", "LANDED", "f".repeat(40)));
  await cycle(fx);
  const landed = readState(repo.layout.state).core.records!;
  assert.deepEqual([landed.result, landed.answer?.state, typeof landed.settled], ["landed as ffffffffffff", "landed", "string"]);
  // Settled, nothing more is followed; the next green run that lists cases records them.
  repo.commit({ "later.txt": "x\n" }, "later");
  assert.equal(await cycle(fx), "core");
  await recordAndApply(fx);
  assert.equal(fx.submitted.length, 3);
  assert.equal(readState(repo.layout.state).core.records!.attempts, 1);
});

test("a held records commit is withdrawn and replaced; past its attempts, a records commit is a task and its rows stay pending", async t => {
  const repo = repository(t);
  const fx = harness(repo, fakeGate(repo), { recorder: newCase() });
  const commit = repo.commit(NEW_CASE, "a new case");
  await cycle(fx);
  await recordAndApply(fx);
  const first = readState(repo.layout.state).core.records!.submitted!;
  fx.queue.answers.set(first, answer("held", "held: the check could not finish"));
  assert.equal(await cycle(fx), "records", "a held one is applied again at once");
  assert.deepEqual(fx.withdrawn, [first], "withdrawn first, so a retry by hand cannot land it behind its replacement");
  for (let attempt = 2; attempt < RECORDS_ATTEMPTS; attempt++) {
    fx.queue.answers.set(readState(repo.layout.state).core.records!.submitted!, answer("refused", "red: tooling FAIL"));
    repo.commit({ [`moved-${attempt}.txt`]: "x\n" }, `main moves on ${attempt}`);
    assert.equal(await cycle(fx), "records");
  }
  const last = readState(repo.layout.state).core.records!;
  assert.equal(last.attempts, RECORDS_ATTEMPTS);
  fx.queue.answers.set(last.submitted!, answer("refused", "red: tooling FAIL"));
  repo.commit({ "moved-last.txt": "x\n" }, "main moves on again");
  assert.equal(await cycle(fx), "core", "not applied again: the core takes the new main");
  const given = readState(repo.layout.state);
  assert.ok(given.tasks.some(one => one.line === `- The full check's core records of ${commit.slice(0, 12)} did not land: refused: red: tooling FAIL; `
    + `not applied again: ${RECORDS_ATTEMPTS} attempt(s) made. Their rows stay pending for the next records run; see ${dirname(last.delta!)}.`), JSON.stringify(given.tasks));
  // Settled, its cases are recorded anew by the core's green run on the new main.
  assert.equal(given.core.records!.commit, repo.git.commit("refs/heads/main"));
  await recordAndApply(fx);
  assert.equal(fx.submitted.length, RECORDS_ATTEMPTS + 1);
  assert.equal(readState(repo.layout.state).core.records!.attempts, 1);
});

test("an attempt that failed waits for main to move, and a records commit the queue lost is submitted again at once", async t => {
  const repo = repository(t);
  let fail = true;
  const applier: Applier = (tree, delta, log) => {
    if (!fail) return applyEveryRow(tree, delta, log);
    writeFileSync(log, "record-pending --apply: a broken main\n");
    return { status: 1, output: "record-pending --apply: a broken main\n" };
  };
  const fx = harness(repo, fakeGate(repo), { recorder: newCase(), applier });
  repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(fx), "core");
  await recordAndApply(fx);
  let records = readState(repo.layout.state).core.records!;
  assert.match(records.result, /^record-pending\.ts --apply exited 1 on main [0-9a-f]{12} \(attempt 1\); see .*record-pending\.apply-1\.log$/);
  assert.deepEqual([records.submitted, records.settled, fx.submitted.length], [null, undefined, 0]);
  fail = false;
  assert.equal(await cycle(fx), "idle", "the same main would fail the same way");
  repo.commit({ "elsewhere.txt": "x\n" }, "main moves on");
  assert.equal(await cycle(fx), "records");
  records = readState(repo.layout.state).core.records!;
  assert.deepEqual([records.attempts, fx.submitted.map(one => one.commit)], [2, [records.submitted]]);
  // The landing queue loses it (its state cleared by hand, say).
  fx.submitted.length = 0;
  assert.equal(await cycle(fx), "records", "on the same main, at once");
  assert.ok(fx.lines.some(line => line.includes("the landing queue has no record of it")), fx.lines.join("\n"));
  assert.equal(readState(repo.layout.state).core.records!.attempts, 3);
});

test("a recorder that leaves records and no delta lands nothing, and is a task", async t => {
  const repo = repository(t);
  const recorder: Recorder = tree => { mkdirSync(join(tree, "results"), { recursive: true }); writeFileSync(join(tree, "results/a.tsv"), "row\n"); return { status: 0, output: "" }; };
  const fx = harness(repo, fakeGate(repo), { recorder });
  repo.commit(NEW_CASE, "a new case");
  await cycle(fx);
  recordIn(fx);
  assert.equal(await cycle(fx), "idle", "nothing to apply: the cycle goes on");
  const state = readState(repo.layout.state);
  assert.deepEqual([state.core.records?.result, state.core.records?.delta, fx.submitted.length], ["wrote 1 record file(s) and no delta", undefined, 0]);
  assert.ok(state.tasks.some(one => one.line.includes("wrote records and no delta")), JSON.stringify(state.tasks));
});

test("the core runs on each new main while a records unit records, and the rows land on the newest main once it ends", async t => {
  const repo = repository(t), gate = fakeGate(repo), fx = harness(repo, gate, { recorder: newCase() });
  const commit = repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(fx), "core");
  const unit = recordsUnitName("core");
  assert.ok(fx.units.running(unit));
  const second = repo.commit({ "b.txt": "b\n" }, "lands while the records run");
  assert.equal(await cycle(fx), "core", "the core takes the new main at once");
  const third = repo.commit({ "c.txt": "c\n" }, "and another");
  assert.equal(await cycle(fx), "core");
  assert.deepEqual(gate.measured.filter(m => m.label === "core").map(m => m.commit), [commit, second, third]);
  assert.equal(verified(repo), third);
  assert.equal(fx.units.specs.length, 1, "the later green runs record nothing while the unit records");
  assert.ok(fx.lines.some(line => line.includes(`the core rows at ${commit.slice(0, 12)} are still being recorded in ${unit}`)), fx.lines.join("\n"));
  assert.equal(await cycle(fx), "idle", "nothing else is due while it records");
  // The unit recorded in the core's records tree at the run's commit, on that tree's own code, while the gate's tree moved on.
  const spec = fx.units.specs[0]!;
  assert.deepEqual([spec.cwd, spec.command.slice(1, 3)], [repo.layout.records.core, [join(repo.layout.records.core, "tooling/full-check/service.ts"), "--record=core"]]);
  assert.equal(new Git(repo.layout.records.core, ENV).commit("HEAD"), commit);
  assert.equal(new Git(repo.layout.tree, ENV).commit("HEAD"), third);
  await recordAndApply(fx);
  const records = readState(repo.layout.state).core.records!;
  assert.equal(records.commit, commit, "recorded at the run's commit");
  assert.equal(repo.git.run(["rev-parse", `${records.submitted}^`]), third, "applied on the newest main, in the records tree");
  assert.equal(new Git(repo.layout.records.core, ENV).commit("HEAD"), records.submitted);
  assert.equal(typeof records.job?.ended, "string", "its outcome was read");
});

test("a controller that restarts while a records unit records adopts it by name, and starts no second one", async t => {
  const repo = repository(t), gate = fakeGate(repo), units = stubUnits();
  repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(harness(repo, gate, { recorder: newCase(), units })), "core");
  const { job, run } = readState(repo.layout.state).core.records!;
  assert.deepEqual(job, { unit: recordsUnitName("core"), outcome: join(run!, RECORDS_OUTCOME), at: job!.at, starts: 1 }, "the state names the unit and its outcome");
  // The controller stops and a new one starts on its state; the unit runs on.
  const after = harness(repo, gate, { recorder: newCase(), units });
  assert.equal(await cycle(after), "idle");
  const moved = repo.commit({ "b.txt": "b\n" }, "lands while the records run");
  assert.equal(await cycle(after), "core");
  assert.equal(units.specs.length, 1, "no second records unit");
  // It ends while no controller runs: the next one reads its outcome and lands its rows.
  recordIn(after);
  const next = harness(repo, gate, { units });
  assert.equal(await cycle(next), "records");
  assert.equal(next.submitted.length, 1);
  assert.equal(repo.git.run(["rev-parse", `${next.submitted[0]!.commit}^`]), moved);
});

test("a records unit gone without an outcome is started once more in a tree set up afresh, and then it is a task", async t => {
  const repo = repository(t), fx = harness(repo, fakeGate(repo), { recorder: newCase() });
  const commit = repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(fx), "core");
  const unit = recordsUnitName("core"), run = readState(repo.layout.state).core.records!.run!;
  // Stopped by hand part way: it wrote a record and the delta of the kinds it finished, and no outcome.
  mkdirSync(join(repo.layout.records.core, "results"), { recursive: true });
  writeFileSync(join(repo.layout.records.core, "results/half.tsv"), "half\n");
  writeFileSync(join(run, DELTA_FILE), "{}\n");
  fx.units.stop(unit);
  assert.equal(await cycle(fx), "idle");
  assert.equal(fx.units.specs.length, 2, "started once more");
  assert.deepEqual([existsSync(join(run, DELTA_FILE)), existsSync(join(repo.layout.records.core, "results/half.tsv"))], [false, false], "what the stopped one wrote is gone");
  const again = readState(repo.layout.state).core.records!;
  assert.equal(again.job!.starts, 2);
  assert.match(again.result, /^recording in nts-full-check-records-core since \S+, started again$/);
  // Gone again: given up, its rows pending for the next records run.
  fx.units.stop(unit);
  assert.equal(await cycle(fx), "idle");
  assert.equal(fx.units.specs.length, 2, "never a third time");
  const given = readState(repo.layout.state);
  assert.equal(typeof given.core.records!.settled, "string");
  assert.ok(given.tasks.some(one => one.line === `- The full check's core records at ${commit.slice(0, 12)} did not finish: ${unit} is gone and wrote no outcome, `
    + `started 2 time(s); see ${join(run, RECORDS_UNIT_LOG)}. Their rows stay pending for the next records run.`), JSON.stringify(given.tasks));
  repo.commit({ "later.txt": "x\n" }, "later");
  assert.equal(await cycle(fx), "core");
  assert.equal(fx.units.specs.length, 3, "the next green run records them anew");
  await recordAndApply(fx);
  assert.equal(fx.submitted.length, 1);
});

test("a records unit that does not start is started once more, then given up", async t => {
  const repo = repository(t), units = stubUnits(), fx = harness(repo, fakeGate(repo), { recorder: newCase(), units });
  units.start = spec => { units.specs.push(spec); return "systemd-run exited 1: Failed to start transient service unit"; };
  repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(fx), "core");
  assert.match(readState(repo.layout.state).core.records!.result, /^nts-full-check-records-core did not start: systemd-run exited 1/);
  assert.equal(await cycle(fx), "idle");
  assert.equal(await cycle(fx), "idle");
  assert.equal(units.specs.length, 2);
  assert.ok(readState(repo.layout.state).tasks.some(one => one.line.includes("did not finish: nts-full-check-records-core is gone and wrote no outcome, started 2 time(s)")));
});

test("a records unit's command is the job its own tree's service.ts parses, and its outcome, written last, says what the recorder wrote", t => {
  const repo = repository(t);
  const commit = repo.commit({ "results/a.tsv": "a\n" }, "recorded here");
  checkoutIn(repo, repo.layout.records.wide)(commit);
  const run = join(repo.root, "run");
  mkdirSync(run);
  const spec = recordsUnit(repo.layout, "wide", { commit, run, pin: "/pins/x/nts" }, "/node");
  const outcome = join(run, RECORDS_OUTCOME), tree = repo.layout.records.wide;
  assert.deepEqual(spec, { name: "nts-full-check-records-wide", cwd: tree, log: join(run, RECORDS_UNIT_LOG),
    command: ["/node", join(tree, "tooling/full-check/service.ts"), "--record=wide", `--commit=${commit}`, `--run=${run}`, "--pin=/pins/x/nts", `--outcome=${outcome}`] });
  const job = parseOptions(spec.command.slice(2)).record!;
  assert.deepEqual(job, { part: "wide", commit, run, pin: "/pins/x/nts", outcome });
  recordJob(tree, job, (dir, pin, at, part) => {
    assert.deepEqual([dir, pin, at, part], [tree, "/pins/x/nts", run, "wide"]);
    assert.equal(existsSync(outcome), false, "the outcome is the work's last act");
    writeFileSync(join(dir, "results/a.tsv"), "a\nb\n");
    writeFileSync(join(dir, "stray.txt"), "x\n");
    return { status: 3, output: "" };
  });
  const written = JSON.parse(readFileSync(outcome, "utf8"));
  assert.deepEqual([written.version, written.status, written.files, written.refused], [1, 3, ["results/a.tsv"], ["stray.txt"]]);
  assert.throws(() => parseOptions(["--record=core", `--commit=${commit}`]), /--record takes --commit, --run, --pin and --outcome/);
  assert.throws(() => parseOptions(["--record=core", "--commit=abc"]), /--commit takes a full commit name/);
  assert.throws(() => parseOptions(["--run=relative/run"]), /--run takes an absolute path/);
  assert.throws(() => parseOptions(["--count", "--once"]), /each a command of its own/);
  assert.deepEqual([parseOptions(["--count"]).count, parseOptions([]).count, parseOptions([]).record], [true, false, null]);
});

test("the wide steps run on verified at a slot, not on main", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const morning = harness(repo, gate, { now: new Date(2026, 10, 6, 9, 0), schedule: { wide: ["10:00"], nightly: "03:00" } });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(morning); // 03:00 was due, nothing verified yet: the core runs
  assert.equal(verified(repo), first);
  repo.commit({ "a.txt": "2\n" }, "on main, not verified yet");
  const later = harness(repo, gate, { now: new Date(2026, 10, 6, 10, 30), schedule: { wide: ["10:00"], nightly: "03:00" } });
  assert.equal(await cycle(later), "wide");
  assert.deepEqual(gate.measured.at(-1), { commit: first, steps: ["integrity"], label: "wide" });
  assert.equal(readState(repo.layout.state).wide.last_green?.commit, first);
  assert.equal(await cycle(later), "core", "the slot is answered; the core takes main");
});

test("the nightly slot runs the wide steps and makes nts-bench due; it runs on verified when nothing else is, and submits its results-only commit", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const bench = stubBench({ slower: ["awfy-list", "richards"] });
  const day = harness(repo, gate, { now: new Date(2026, 10, 6, 23, 0), bench });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(day); // the 22:00 slot finds nothing verified; the core verifies main
  assert.equal(verified(repo), first);
  const night = harness(repo, gate, { now: new Date(2026, 10, 7, 3, 30), bench });
  assert.equal(await cycle(night), "wide");
  assert.equal(bench.calls.length, 0, "the slot makes the benchmarks due; it does not run them");
  assert.ok(readState(repo.layout.state).benchmarks_due);
  assert.equal(await cycle(night), "benchmarks");
  assert.equal(readState(repo.layout.state).benchmarks_due, undefined);
  const labels = gate.measured.map(m => `${m.label} ${m.steps.join(" ")}`);
  assert.deepEqual(labels.slice(-2), ["wide integrity", "bench-build build"], "nts-bench is built from the commit it measures");
  assert.equal(bench.calls.length, 1);
  const state = readState(repo.layout.state);
  assert.equal(state.bench?.commit, first);
  assert.equal(state.bench?.measured, true);
  assert.equal(state.bench?.outcome, "record");
  const results = state.bench!.submitted!;
  assert.ok(results, state.bench?.result);
  assert.deepEqual(night.submitted, [{ commit: results, first: false }]);
  assert.equal(repo.git.run(["rev-parse", `${results}^`]), first);
  assert.equal(repo.git.commit(`refs/full-check/benchmarks/${first.slice(0, 12)}`), results);
  assert.ok(night.lines.some(line => line.includes("TASK") && line.includes("2 benchmark row(s) slower than their own best") && line.includes("awfy-list, richards")), night.lines.join("\n"));
  assert.deepEqual(readState(repo.layout.state).bench?.slower, ["awfy-list", "richards"], "the slower rows are kept for the status");

  // The next night, verified unchanged: no second run of the same commit.
  const next = harness(repo, gate, { now: new Date(2026, 10, 8, 3, 30), bench });
  await cycle(next);
  assert.equal(bench.calls.length, 1);
  assert.ok(next.lines.some(line => line.includes("already measured")));
});

test("an attempt the measurement lock does not admit keeps nothing and leaves the benchmarks due, asked again later; a night that never ran is replaced by the next and says what held it", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const refusal = "with-lock: pid 4242 is measuring; not starting another";
  const bench = stubBench({ refuse: [refusal, refusal] });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(harness(repo, gate, { now: new Date(2026, 10, 6, 23, 0) }));
  const night = harness(repo, gate, { now: new Date(2026, 10, 7, 3, 30), bench });
  assert.equal(await cycle(night), "wide");
  assert.equal(await cycle(night), "idle", "not admitted, the cycle goes on");
  const waiting = readState(repo.layout.state);
  assert.equal(bench.calls.length, 1);
  assert.equal(waiting.benchmarks_due?.waiting, `not admitted: ${refusal}`);
  assert.equal(waiting.bench, undefined, "an attempt that started nothing ends nothing");
  assert.deepEqual(readdirSync(repo.layout.runs).filter(name => /^bench-[0-9a-f]{12}-\d+$/.test(name)), [], "nothing of it is kept");
  assert.equal(await cycle(night), "idle", "and it is not asked again at once");
  assert.equal(bench.calls.length, 1);
  await cycle(harness(repo, gate, { now: new Date(new Date(2026, 10, 7, 3, 30).getTime() + BENCH_ASK_AGAIN_MS), bench }));
  assert.equal(bench.calls.length, 2, "asked again later");
  // The next nightly slot comes first: it replaces the night, saying what held it, and measures.
  const next = harness(repo, gate, { now: new Date(2026, 10, 8, 3, 30), bench });
  assert.equal(await cycle(next), "benchmarks");
  assert.ok(next.lines.some(line => line.includes(`not run: not admitted: ${refusal}; the nightly slot at`) && line.includes("replaced the night")), next.lines.join("\n"));
  const measured = readState(repo.layout.state);
  assert.equal(measured.bench?.outcome, "record");
  assert.equal(measured.bench?.commit, first);
  assert.equal(measured.bench?.measured, true);
});

test("a nightly slot the controller first reaches after a later wide slot still makes the benchmarks due", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const bench = stubBench();
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  assert.equal(await cycle(harness(repo, gate, { now: new Date(2026, 10, 6, 23, 0), bench })), "core");
  // Busy from before 03:00 until after 10:00 (a records run, say): 10:00 is the latest slot the wide steps see.
  const late = harness(repo, gate, { now: new Date(2026, 10, 7, 10, 30), bench });
  assert.equal(await cycle(late), "wide");
  assert.ok(readState(repo.layout.state).benchmarks_due, "the 03:00 night is due all the same");
  assert.equal(await cycle(late), "benchmarks");
  assert.equal(readState(repo.layout.state).bench?.commit, first);
  assert.equal(bench.calls.length, 1);
});

test("only a run that kept a record counts as measured: one that kept none ends the night as a task, and the next night measures the same verified", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(harness(repo, gate, { now: new Date(2026, 10, 6, 23, 0) }));
  const night = harness(repo, gate, { now: new Date(2026, 10, 7, 3, 30), bench: stubBench({ noRecord: true }) });
  assert.equal(await cycle(night), "wide");
  assert.equal(await cycle(night), "benchmarks");
  const ended = readState(repo.layout.state);
  assert.equal(ended.bench?.outcome, "no-record");
  assert.equal(ended.bench?.measured, false);
  assert.match(ended.bench!.result, /^nts-bench exited 1: nts-bench committed no run record$/);
  assert.equal(ended.benchmarks_due, undefined, "the night has its answer");
  assert.ok(ended.tasks.some(one => one.line.includes("kept no run record")), JSON.stringify(ended.tasks));
  const bench = stubBench();
  assert.equal(await cycle(harness(repo, gate, { now: new Date(2026, 10, 8, 3, 30), bench })), "benchmarks", "nothing was measured, so the next night measures the same commit");
  assert.equal(bench.calls.length, 1);
  assert.equal(readState(repo.layout.state).bench?.commit, first);
  assert.equal(readState(repo.layout.state).bench?.measured, true);
});

test("an attempt a stopped controller cut short is found by the next cycle and tried again; past its interruptions the night is given up as a task", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  let left = "";
  const dying = stubBench({ during: () => { left = readFileSync(repo.layout.state, "utf8"); } });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(harness(repo, gate, { now: new Date(2026, 10, 6, 23, 0) }));
  const night = harness(repo, gate, { now: new Date(2026, 10, 7, 3, 30), bench: dying });
  assert.equal(await cycle(night), "wide");
  assert.equal(await cycle(night), "benchmarks");
  // The controller stopped while nts-bench measured: the state is as it left it then.
  writeFileSync(repo.layout.state, left);
  assert.equal(readState(repo.layout.state).benchmarks_due?.measuring?.commit, first, "the attempt is written down before nts-bench starts");
  const after = harness(repo, gate, { now: new Date(2026, 10, 7, 4, 0), bench: dying });
  assert.equal(await cycle(after), "benchmarks", "tried again");
  assert.ok(after.lines.some(line => line.includes("interrupted: the controller stopped while nts-bench measured") && line.includes("tried again")), after.lines.join("\n"));
  assert.equal(readState(repo.layout.state).bench?.outcome, "record");
  // Stopped during every attempt: the night is given up once it has lost BENCH_INTERRUPTIONS of them.
  for (let lost = 2; lost <= BENCH_INTERRUPTIONS; lost++) {
    writeFileSync(repo.layout.state, left);
    await cycle(harness(repo, gate, { now: new Date(2026, 10, 7, 4, 30), bench: dying }));
  }
  const given = readState(repo.layout.state);
  assert.equal(given.benchmarks_due, undefined);
  assert.equal(given.bench?.outcome, "interrupted");
  assert.equal(given.bench?.measured, false);
  assert.match(given.bench!.result, new RegExp(`interrupted ${BENCH_INTERRUPTIONS} times this night`));
  assert.ok(given.tasks.some(one => one.line.includes(`interrupted ${BENCH_INTERRUPTIONS} times`)), JSON.stringify(given.tasks));
  assert.equal(dying.calls.length, BENCH_INTERRUPTIONS, "one attempt each time, and none once the night is given up");
});

test("the core goes first while the benchmarks are due, and they then measure the newest verified", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const bench = stubBench();
  repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(harness(repo, gate, { now: new Date(2026, 10, 6, 23, 0) }));
  const night = harness(repo, gate, { now: new Date(2026, 10, 7, 3, 30), bench });
  assert.equal(await cycle(night), "wide");
  const second = repo.commit({ "a.txt": "2\n" }, "landed while the benchmarks wait");
  assert.equal(await cycle(night), "core");
  assert.equal(bench.calls.length, 0);
  assert.equal(verified(repo), second);
  assert.equal(await cycle(night), "benchmarks");
  assert.equal(readState(repo.layout.state).bench?.commit, second);
});

/** The hourly count's effects over the scratch repository's layout: a green machine, an empty cache, unless a test says otherwise. */
function counting(repo: Repository, options: Partial<CountEffects> = {}): CountEffects & { lines: string[] } {
  const lines: string[] = [];
  return {
    count: () => ({ verdict: "PASS", red: [], notes: [], removable: [] }),
    sweep: () => [],
    prunePool: () => [],
    pruneNodeCache: () => ({root:"private fixture",state:"missing",removed:0,removedBytes:0,kept:0,keptBytes:0,changed:0,skipped:0,errors:[]}),
    file: repo.layout.count,
    now: () => new Date(2026, 10, 6, 12, 0),
    log: line => lines.push(line),
    ...options,
    lines,
  };
}

test("the hourly count runs the pool's upkeep first and writes what it found to its own file; a failed upkeep is a line, not a stopped count", t => {
  const repo = repository(t);
  const order: string[] = [];
  let fail = false;
  const fx = counting(repo, {
    prunePool: () => { order.push("pool"); if (fail) throw new Error("the pool's lock is held"); return ["pool: removed tree 3, free and idle 4d 2h"]; },
    count: () => { order.push("count"); return { verdict: "FAIL", red: ["branch x (on the machine): named by no open issue"], notes: ["not counted: GitHub's branches"], removable: [] }; },
  });
  const counted = { at: fx.now().toISOString(), verdict: "FAIL", lines: ["branch x (on the machine): named by no open issue", "not counted: GitHub's branches"] };
  assert.deepEqual(countOnce(fx), counted);
  assert.deepEqual(order, ["pool", "count"]);
  assert.ok(fx.lines.includes("pool: removed tree 3, free and idle 4d 2h"), fx.lines.join("\n"));
  assert.deepEqual(readCount(repo.layout.count), counted, "the count's own file, in the shape the status gives it");
  assert.equal(existsSync(repo.layout.state), false, "and nothing of the controller's");
  fail = true;
  countOnce(fx);
  assert.ok(fx.lines.includes("pool: upkeep failed: the pool's lock is held"), fx.lines.join("\n"));
  assert.deepEqual(order, ["pool", "count", "pool", "count"], "and the count still ran");
});

test("the count runs while a part runs, writing nothing of the controller's, and names the pin a records unit records with", async t => {
  const repo = repository(t), gate = fakeGate(repo), fx = harness(repo, gate, { recorder: newCase() });
  const commit = repo.commit(NEW_CASE, "a new case");
  const run = gate.run.bind(gate), counted: CountRecord[] = [];
  gate.run = (at, steps, label) => {
    const before = readFileSync(repo.layout.state, "utf8");
    counted.push(countOnce(counting(repo)));
    assert.equal(readFileSync(repo.layout.state, "utf8"), before, "the controller is its state's only writer");
    return run(at, steps, label);
  };
  assert.equal(await cycle(fx), "core");
  assert.equal(counted.length, 1, "it counted while the core ran: it waits for no cycle");
  assert.deepEqual(readCount(repo.layout.count), counted[0]);
  // While the core's records unit records, the count keeps its pin, whatever main and verified are by then.
  const pin = readState(repo.layout.state).core.records!.pin!;
  assert.deepEqual([basename(dirname(pin)), recordingPins(readState(repo.layout.state))], [commit.slice(0, 12), [commit.slice(0, 12)]]);
  await recordAndApply(fx);
  assert.deepEqual(recordingPins(readState(repo.layout.state)), [], "once the unit ended, the pin is no records unit's");
});

test("the parts' steps come from the measured commit's lists", () => {
  const lists = { all: ["build", "tests", "integrity", "profile"], wide: ["integrity", "profile", "gone"] };
  assert.deepEqual(partSteps("core", lists), ["build", "tests"]);
  assert.deepEqual(partSteps("wide", lists), ["integrity", "profile"]);
});

test("the command line sets the schedule", () => {
  assert.deepEqual(parseOptions(["--wide-at=16:00,10:00", "--nightly-at=02:30"]).schedule, { wide: ["10:00", "16:00"], nightly: "02:30" });
  assert.deepEqual(parseOptions(["--bench-wait=240"]).ignored, ["--bench-wait=240"], "a unit written before the benchmarks stayed due until the next nightly slot still starts");
  assert.deepEqual(parseOptions([]).ignored, []);
  assert.throws(() => parseOptions(["--wide-at=25:00"]), /not a time of day/);
  assert.throws(() => parseOptions(["--bogus"]), /unknown argument/);
});

test("the stand-in tree is a worktree of the scratch repository", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const commit = repo.commit({ "a.txt": "1\n" }, "one");
  gate.run(commit, ["tests"], "check");
  assert.equal(new Git(repo.layout.tree, ENV).run(["rev-parse", "HEAD"]), commit);
});


test("cache upkeep runs with the hourly count, and its warnings never change the count's verdict", t => {
  const repo = repository(t);
  let calls = 0;
  const fx = counting(repo, { pruneNodeCache: () => {
    calls++;
    return {root:"private fixture",state:"warning",removed:2,removedBytes:17,kept:1,keptBytes:9,changed:0,skipped:0,errors:["private cache control"]};
  } });
  assert.equal(countOnce(fx).verdict, "PASS");
  assert.equal(calls, 1);
  assert.ok(fx.lines.some(line => line.includes("removed 2 entries / 17 bytes")));
  assert.ok(fx.lines.some(line => line.includes("private cache control")));
  fx.pruneNodeCache = () => { calls++; throw new Error("unreadable private cache"); };
  assert.equal(countOnce(fx).verdict, "PASS");
  assert.equal(calls, 2);
  assert.equal(readCount(repo.layout.count)?.verdict, "PASS");
  assert.ok(fx.lines.some(line => line.includes("unreadable private cache")));
});

test("the controller follows verified with the inputs its new code needs, or stays on its own code", t => {
  const repo = repository(t);
  const first = repo.commit({ "a.txt": "1\n" }, "first"), second = repo.commit({ "a.txt": "2\n" }, "second");
  repo.git.run(["branch", "verified", second]);
  repo.git.run(["checkout", "-q", "--detach", first]);
  const layout = { ...repo.layout, controller: repo.dir }, linked: string[] = [];
  const refuse = (tree: string) => {
    const at = new Git(tree, ENV).commit("HEAD")!; linked.push(at);
    if (at === second) throw new Error("dependency-inputs.ts --offline: a package is not in the registry cache");
  };
  // Inputs that cannot be linked keep the code that runs: the tree goes back, its own inputs linked again.
  assert.equal(followVerified(repo.git, layout, repo.dir, refuse), false);
  assert.equal(repo.git.commit("HEAD"), first);
  assert.deepEqual(linked, [second, first]);
  linked.length = 0;
  assert.equal(followVerified(repo.git, layout, repo.dir, tree => { linked.push(new Git(tree, ENV).commit("HEAD")!); }), true);
  assert.equal(repo.git.commit("HEAD"), second);
  assert.deepEqual(linked, [second], "the new code's inputs are linked after its checkout");
  // A service that does not run from the controller never moves it.
  assert.equal(followVerified(repo.git, { ...layout, controller: join(repo.root, "elsewhere") }, repo.dir, () => assert.fail("linked")), false);
});

test("the controller moves to verified only while no count reads its tree", t => {
  const repo = repository(t);
  const first = repo.commit({ "a.txt": "1\n" }, "first"), second = repo.commit({ "a.txt": "2\n" }, "second");
  repo.git.run(["branch", "verified", second]);
  repo.git.run(["checkout", "-q", "--detach", first]);
  const layout = { ...repo.layout, controller: repo.dir };
  // As the count's service holds it while it counts: flock --shared on the controller's lock.
  mkdirSync(dirname(layout.controllerLock), { recursive: true });
  const count = openSync(layout.controllerLock, "a");
  assert.equal(spawnSync("flock", ["--shared", "--nonblock", "8"], { stdio: ["ignore", "ignore", "inherit", null, null, null, null, null, count] }).status, 0);
  const linked: string[] = [], link = (tree: string) => { linked.push(new Git(tree, ENV).commit("HEAD")!); };
  assert.equal(followVerified(repo.git, layout, repo.dir, link), false);
  assert.deepEqual([repo.git.commit("HEAD"), linked], [first, []], "the tree does not move while the count reads it");
  closeSync(count);
  assert.equal(followVerified(repo.git, layout, repo.dir, link), true);
  assert.deepEqual([repo.git.commit("HEAD"), linked], [second, [second]]);
  const after = GateResource.tryAcquire(layout.controllerLock);
  assert.ok(after, "and the controller let it go");
  after.close();
});

test("a culprit its own part is green after is cleared and its waiting revert withdrawn, though the other part was never green", async t => {
  const repo = repository(t);
  const fx = harness(repo, fakeGate(repo));
  repo.commit({ "src.txt": "base\n", "RED/integrity": "" }, "good, with the wide steps red from the start");
  await cycle(fx);
  const b = repo.commit({ "RED/tests": "", "b.txt": "b\n" }, "b: breaks tests");
  await cycle(fx);
  const revert = readState(repo.layout.state).culprits.find(c => c.commit === b)?.revert;
  assert.ok(revert, fx.lines.join("\n"));
  assert.deepEqual(fx.submitted, [{ commit: revert, first: true }]);
  // Fixed forward while the revert waits: the core is green with b in.
  const fixed = repo.commit({ "RED/tests": null }, "fix tests forward");
  await cycle(fx);
  const state = readState(repo.layout.state);
  assert.equal(state.core.last_green?.commit, fixed);
  assert.equal(state.wide.last_green, undefined, "the wide steps have never been green");
  assert.deepEqual(state.culprits, []);
  assert.deepEqual(fx.withdrawn, [revert], "landing the revert would take out a commit the core is green with");
  assert.ok(fx.lines.some(line => line === `${b.slice(0, 12)} is no culprit: core was green after it at ${fixed.slice(0, 12)}; its revert ${revert.slice(0, 12)} is withdrawn`), fx.lines.join("\n"));
});

test("the recorder runs in the gate's canonical environment, in a temporary folder its run owns", t => {
  const repo = repository(t), tree = join(repo.root, "tree"), run = join(repo.root, "run");
  mkdirSync(join(tree, "tooling/records"), { recursive: true });
  mkdirSync(run);
  candidateEnvironmentFixture(tree);
  // The fake recorder reports what the oracles it would run are given.
  writeFileSync(join(tree, "tooling/records/record-pending.ts"), `import {existsSync} from "node:fs";
console.log(JSON.stringify({ canonical: !!process.env.NTS_GATE_ENV_CONTEXT, tmp: process.env.TMPDIR, there: existsSync(process.env.TMPDIR ?? ""), bin: process.env.NTS_BIN, argv: process.argv.slice(2) }));
`);
  const result = recordPending(tree, "pin", run, "core", {env:{...hostEnvironment(process.env),HOME:repo.root}});
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(readFileSync(join(run, RECORDER_LOG), "utf8")), { canonical: true, tmp: join(run, "records", "tmp"), there: true, bin: "pin", argv: ["--after", "core", run] },
    "it records the kinds of the part that went green, from that run's logs");
  assert.equal(existsSync(join(run, "records", "tmp")), false, "its temporary folder goes after it");
});

test("the recorder's output reaches the run's log while it runs, so no buffer bounds it", t => {
  const repo = repository(t), tree = join(repo.root, "tree"), run = join(repo.root, "run"), log = join(run, RECORDER_LOG);
  mkdirSync(join(tree, "tooling/records"), { recursive: true });
  mkdirSync(run);
  candidateEnvironmentFixture(tree);
  // The core run's own `records` step logs beside it; the recorder leaves that log alone.
  writeFileSync(join(run, "records.log"), "the records step's log\n");
  // The fake recorder looks for its own first line in the log before it exits.
  writeFileSync(join(tree, "tooling/records/record-pending.ts"), `import {existsSync, readFileSync} from "node:fs";
process.stdout.write("first line\\n");
const seen = existsSync(${JSON.stringify(log)}) && readFileSync(${JSON.stringify(log)}, "utf8").includes("first line");
process.stdout.write(seen ? "streamed\\n" : "buffered\\n");
process.exit(seen ? 3 : 4);
`);
  const result = recordPending(tree, "pin", run, "core", {env:{...hostEnvironment(process.env),HOME:repo.root}});
  assert.equal(result.status, 3, readFileSync(log, "utf8"));
  assert.equal(readFileSync(log, "utf8"), "first line\nstreamed\n");
  assert.equal(result.output, "first line\nstreamed\n", "the result carries the log's tail");
  assert.equal(readFileSync(join(run, "records.log"), "utf8"), "the records step's log\n");
});

test('each records run uses its candidate Node and environment and closes its resolution session',async t=>{
  for(const status of [0,1]){
    const repo=repository(t),tree=join(repo.root,'tree'),run=join(repo.root,'run'),installations=join(repo.root,'installed');
    mkdirSync(join(tree,'tooling/records'),{recursive:true});mkdirSync(run);
    candidateEnvironmentFixture(tree);candidateVersion(tree,'recorder');
    const observed=join(run,'observed.json'),session=join(run,'retained-session');
    writeFileSync(join(tree,'tooling/records/record-pending.ts'),resolutionSubject(observed,session,status));
    const log=join(repo.root,'nodes.jsonl');nodeInstallation(installations,process.versions.node,log);
    const result=recordPending(tree,'private-pin',run,'core',{nodeInstallations:installations,env:{...hostEnvironment(process.env),HOME:repo.root}});
    assert.equal(result.status,status,result.output);
    const value=JSON.parse(readFileSync(observed,'utf8'));assert.equal(value.version,'recorder');assert.equal(value.canonical,true);
    assert.equal(value.node,process.versions.node);assert.equal(value.bin,'private-pin');assert.equal(value.there,true);
    assert.equal(existsSync(join(run,'records/tmp')),false,'recorder scratch still goes on every exit status');
    assert.ok(readFileSync(log,'utf8').includes('candidate-environment.ts'),'the recorder uses the selected Node');
    await assertSessionClosed(observed);
  }
});

test('records use the newly verified environment, in the records tree at the verified commit',async t=>{
  const repo=repository(t),installations=join(repo.root,'installed'),observed=join(repo.root,'observed.json'),session=join(repo.root,'retained-session');
  candidateEnvironmentFixture(repo.dir);candidateVersion(repo.dir,'new-verified');
  nodeInstallation(installations,process.versions.node,join(repo.root,'nodes.jsonl'));
  repo.git.run(['add','-f','tooling','.tool-versions']);
  // Like record-pending.ts --after, it leaves the delta of what it recorded in the run's folder.
  const delta={version:1,commit:null,headers:{},rows:[{kind:'outcomes',record:'results/fresh.tsv',case:'results',key:'results',before:null,after:'fresh row\n',sources:'0'.repeat(64)}]};
  const script=resolutionSubject(observed,session,0)+`import {mkdirSync} from 'node:fs';mkdirSync('results',{recursive:true});writeFileSync('results/fresh.tsv','fresh row\\n');`
    +`writeFileSync(process.argv[4]+'/${DELTA_FILE}',${JSON.stringify(JSON.stringify(delta))});\n`;
  const commit=repo.commit({'tooling/records/record-pending.ts':script,'LOG/tests':'pending: private-case is not recorded in results/fresh.tsv yet\n'},'new verified environment');
  let calls=0;
  const fx=harness(repo,fakeGate(repo),{recorder:(tree,pin,run,part)=>{
    calls++;
    assert.equal(repo.git.commit('verified'),commit,'verified moves before recording');
    assert.equal(tree,repo.layout.records.core,'the records unit records in the core\'s records tree');
    assert.equal(new Git(tree,ENV).commit('HEAD'),commit,'recordAt uses that exact tree');
    return recordPending(tree,pin,run,part,{nodeInstallations:installations,env:{...hostEnvironment(process.env),HOME:repo.root}});
  }});
  await cycle(fx);
  await recordAndApply(fx);
  assert.equal(calls,1);
  assert.equal(JSON.parse(readFileSync(observed,'utf8')).version,'new-verified','the records unit imports the verified tree environment');
  assert.equal(readState(repo.layout.state).core.records?.commit,commit);
  assert.equal(fx.submitted.length,1,'the resulting records are submitted');
  await assertSessionClosed(observed);
});

test("the hourly count removes what it found removable, then counts again", t => {
  const repo = repository(t);
  const left = { path: "/home/u/.cache/nts-messages/run-stopped", why: "left by tooling/messages.ts 2.0 days ago" };
  let counted = 0;
  const swept: string[][] = [];
  const fx = counting(repo, {
    count: () => counted++ === 0
      ? { verdict: "FAIL", red: ["~/.cache/nts-messages: 1 folder(s) left"], notes: [], removable: [left] }
      : { verdict: "PASS", red: [], notes: [], removable: [] },
    sweep: removable => { swept.push(removable.map(one => one.path)); return [`swept ~/.cache/nts-messages/run-stopped: ${left.why}`]; },
  });
  assert.equal(countOnce(fx).verdict, "PASS");
  assert.deepEqual(swept, [[left.path]]);
  assert.equal(counted, 2, "what is left is counted after the sweep");
  assert.equal(readCount(repo.layout.count)?.verdict, "PASS");
  assert.ok(fx.lines.includes(`swept ~/.cache/nts-messages/run-stopped: ${left.why}`), fx.lines.join("\n"));
});

test("a culprit that names its issue reopens it, with the red steps, their logs and the revert; one that names none, or one gh cannot tell, is a task line", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const fx = harness(repo, gate);
  repo.commit({ "src.txt": "base\n" }, "good");
  await cycle(fx);
  repo.commit({ "a.txt": "a\n" }, "a: harmless");
  const b = repo.commit({ "RED/typescript-c": "", "b.txt": "b\n" }, "b: breaks typescript-c\n\nFixes #42");
  await cycle(fx);
  const state = readState(repo.layout.state);
  const revert = state.culprits[0]!.revert!;
  assert.equal(state.culprits[0]!.commit, b);
  assert.deepEqual(fx.told.map(one => one.n), [42]);
  const comment = fx.told[0]!.comment, run = state.core.last_run!.run;
  assert.match(comment, new RegExp(`^The full check found that ${b.slice(0, 12)} \\("b: breaks typescript-c"\\) turned typescript-c red in its core run`));
  assert.ok(comment.includes(`\`${run}/typescript-c.log\``), comment);
  assert.ok(comment.includes(`Its revert, ${revert.slice(0, 12)}, is queued first`), comment);
  assert.ok(fx.lines.includes("issue #42 is open again"), fx.lines.join("\n"));
  assert.ok(!fx.lines.some(line => line.startsWith("TASK")), "the reopened issue is the task");

  // gh cannot tell the issue: the task line is kept, and says why.
  const failing = repository(t), down = harness(failing, fakeGate(failing), { issue: n => ({ ok: false, line: `issue #${n} was not told: no network` }) });
  failing.commit({ "src.txt": "base\n" }, "good");
  await cycle(down);
  failing.commit({ "RED/typescript-c": "" }, "breaks it\n\nPart of #7");
  await cycle(down);
  assert.deepEqual(down.told.map(one => one.n), [7]);
  assert.ok(down.lines.includes("issue #7 was not told: no network"));
  assert.ok(down.lines.some(line => line.startsWith("TASK for an issue: - Land ")), down.lines.join("\n"));
});

test("an issue is told before it is reopened, and a failure of either is said", () => {
  const calls: { args: readonly string[]; input?: string }[] = [];
  const gh = (fail?: string): Gh => (args, input) => { calls.push({ args, input }); return args[1] === fail ? { status: 1, stderr: `${fail} refused` } : { status: 0, stderr: "" }; };
  assert.deepEqual(reopenIssue(gh(), 42, "what went red"), { ok: true, line: "issue #42 is open again, with the red steps, their logs and the revert" });
  assert.deepEqual(calls, [{ args: ["issue", "comment", "42", "--body-file", "-"], input: "what went red" }, { args: ["issue", "reopen", "42"], input: undefined }]);
  calls.length = 0;
  assert.deepEqual(reopenIssue(gh("comment"), 42, "x"), { ok: false, line: "issue #42 was not told: comment refused" });
  assert.equal(calls.length, 1, "an issue that was not told is not reopened");
  assert.deepEqual(reopenIssue(gh("reopen"), 42, "x"), { ok: false, line: "issue #42 was told, but not reopened: reopen refused" });
});

test("the state says what the controller is doing while a part runs, and nothing once it ends", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const seen: unknown[] = [];
  const run = gate.run.bind(gate);
  gate.run = (commit, steps, label) => { seen.push(readState(repo.layout.state).now); return run(commit, steps, label); };
  const fx = harness(repo, gate);
  const commit = repo.commit({ "a.txt": "1\n" }, "first");
  assert.equal(await cycle(fx), "core");
  assert.deepEqual(seen, [{ doing: "core", commit, since: fx.now().toISOString() }]);
  assert.equal(readState(repo.layout.state).now, undefined);
});

test("the status model: what a live controller does, how far verified is behind and since when, numbers as numbers", () => {
  const state = { ...readState("/nonexistent"), now: { doing: "records" as const, commit: "c".repeat(40), since: "2026-11-09T10:00:00.000Z" }, pushed: "v".repeat(40),
    benchmarks_due: { since: "2026-11-09T03:00:05.000Z", until: "2026-11-10T03:00:00.000Z", waiting: `the core on main ${"m".repeat(12)} goes first` }, nightly: "2026-11-09T03:00:05.000Z" };
  state.core.last_green = { commit: "v".repeat(40), run: "/runs/core", verdict: "green", at: "2026-11-09T09:00:00.000Z", failed: [], listed: { pending: 3, accepted: 1 } };
  const count = { at: "2026-11-09T10:00:03.000Z", verdict: "FAIL", lines: ["branch x (on the machine): named by no open issue and not in docs/plan.md"] };
  const inputs = {
    main: "m".repeat(40), verified: "v".repeat(40), unverified: ["a".repeat(40), "m".repeat(40)],
    landedAt: (commit: string) => commit.startsWith("a") ? "2026-11-09T10:30:00.000Z" : "2026-11-09T10:50:00.000Z",
    controller: { pid: 42, alive: true }, count, now: new Date("2026-11-09T11:00:00.000Z"),
  };
  const s = fullCheckStatus(state, inputs);
  assert.equal(s.version, 2);
  assert.equal(s.kind, "full-check");
  assert.deepEqual(s.now, { ...state.now, seconds: 3600 });
  assert.deepEqual(s.behind, { commits: 2, oldest_landed_at: "2026-11-09T10:30:00.000Z", delay_s: 1800 });
  assert.deepEqual(s.core.records, { listed: { pending: 3, accepted: 1 }, last: null });
  assert.deepEqual(s.wide.records, { listed: null, last: null });
  assert.deepEqual(s.verified, { commit: "v".repeat(40), pushed: "v".repeat(40) });
  assert.equal(fullCheckStatus(state, { ...inputs, controller: { pid: 42, alive: false } }).now, null, "a stopped controller is doing nothing");
  assert.equal(fullCheckStatus(state, { ...inputs, verified: null, unverified: null }).behind, null);
  assert.deepEqual(fullCheckStatus(state, { ...inputs, unverified: [] }).behind, { commits: 0, oldest_landed_at: null, delay_s: null });
  const text = statusText(s);
  assert.match(text, /^controller: running \(pid 42\); records at cccccccccccc for 60 min$/m);
  assert.match(text, /^verified vvvvvvvvvvvv: 2 commit\(s\) behind main, the oldest landed 30 min ago$/m);
  assert.match(text, /^records: core 3 pending and 1 accepted listed; last none\n {9}wide none listed; last none$/m);
  assert.equal(s.benchmarks.slot, "2026-11-09T03:00:05.000Z");
  assert.match(text, /^benchmarks: none; due until 2026-11-10T03:00:00\.000Z, waiting: the core on main m{12} goes first$/m);
  // The count is the count's own file's, in the shape the cycle's count had.
  assert.deepEqual(s.count, count);
  assert.match(text, /^count: FAIL at 2026-11-09T10:00:03\.000Z, 1 line\(s\)\n {2}branch x \(on the machine\): named by no open issue/m);
  assert.equal(fullCheckStatus(state, { ...inputs, count: null }).count, null, "before the first count");
  assert.deepEqual(parseOptions(["--status", "--json"]).json, true);
  assert.throws(() => parseOptions(["--json"]), /--json is for --status/);
});

test("each part records after its own green run: the wide kinds after the wide run, at the commit the core recorded too", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const parts: string[] = [];
  const recorder: Recorder = (tree, pin, run, part) => {
    parts.push(part);
    writeFileSync(join(run, RECORDER_LOG), "recorded\n");
    return recording({ [`results/records/${part}.tsv`]: "row\n" })(tree, pin, run, part);
  };
  const schedule = { wide: ["10:00"], nightly: "03:00" }, queue = stubQueue();
  const units = stubUnits(), morning = harness(repo, gate, { now: new Date(2026, 10, 6, 9, 0), schedule, recorder, queue, units });
  const first = repo.commit({
    "LOG/typescript-c": "  pending: tests/typescript/a.ts is not recorded in results/typescript/c/cases.tsv yet\n",
    "LOG/integrity": "  pending: tests/programs/b is not recorded in results/dex/outcomes.tsv yet\n",
  }, "each part lists a case of its own");
  assert.equal(await cycle(morning), "core");
  // The core's records unit still records when the wide slot comes: the parts record each in its own unit and tree.
  const later = harness(repo, gate, { now: new Date(2026, 10, 6, 10, 30), schedule, recorder, queue, units });
  assert.equal(await cycle(later), "wide");
  assert.ok(units.running(recordsUnitName("core")) && units.running(recordsUnitName("wide")), "the two parts' records units run at once");
  assert.deepEqual(units.specs.map(spec => spec.cwd), [repo.layout.records.core, repo.layout.records.wide]);
  await recordAndApply(later, "wide");
  await recordAndApply(later, "core");
  assert.deepEqual(parts, ["wide", "core"], "the wide run is not skipped because the core already records this commit");
  const state = readState(repo.layout.state);
  assert.equal(state.core.records?.commit, first);
  assert.equal(state.wide.records?.commit, first);
  assert.deepEqual(state.wide.last_green?.listed, { pending: 1, accepted: 0 });
  assert.equal(queue.submitted.length, 2, "one records commit for each part");
});

test("a state written before each part kept its records reads them as the core's, and one with the cycle's count reads without it", t => {
  const repo = repository(t);
  mkdirSync(dirname(repo.layout.state), { recursive: true });
  writeFileSync(repo.layout.state, JSON.stringify({ version: 1, core: {}, wide: {}, culprits: [], probes: [], tasks: [],
    records: { commit: "c".repeat(40), at: "2026-11-09T11:38:29.560Z", submitted: null, result: "recorded nothing" },
    count: { at: "2026-11-09T10:51:58.846Z", verdict: "FAIL", lines: ["stale"] } }));
  const state = readState(repo.layout.state);
  assert.equal(state.core.records?.commit, "c".repeat(40));
  assert.equal((state as { records?: unknown }).records, undefined);
  assert.equal(state.wide.records, undefined);
  assert.equal((state as { count?: unknown }).count, undefined, "the count's own file says what it found");
});

test("a records run the controller recorded synchronously before units, cut short, holds nothing: the next green run records anew", async t => {
  const repo = repository(t);
  mkdirSync(dirname(repo.layout.state), { recursive: true });
  // As a controller stopped part way through recording in its own process leaves it: no unit, no delta.
  writeFileSync(repo.layout.state, JSON.stringify({ version: 1, core: { records: { commit: "c".repeat(40), at: "2026-11-09T18:14:00.000Z", submitted: null, result: "recording" } },
    wide: {}, culprits: [], probes: [], tasks: [] }));
  const fx = harness(repo, fakeGate(repo), { recorder: newCase() });
  const commit = repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(fx), "core");
  assert.equal(readState(repo.layout.state).core.records?.commit, commit);
  assert.ok(fx.units.running(recordsUnitName("core")));
});
