import {generatedJavaScript} from '../gate/generated-javascript.ts';
import {fixtureEnvironment} from "../gate/test-environment.ts";
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
import {spawn,spawnSync} from "node:child_process";
import {chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {test} from "node:test";
import {randomUUID} from 'node:crypto';
import {testScratch} from '../gate/test-scratch.ts';
import {waitFor,spawnTest} from '../gate/test-wait.ts';
import {applyEveryRow, assertMessage, checkoutIn, fakeGate, publishEveryRun, recording, repository, stubBench, stubQueue, stubUnits, type FakeGate, type Repository, type StubQueue, type StubUnits} from "./repository-fixture.ts";
import type { Applier, Recorder } from "./records.ts";
import {BENCH_ASK_AGAIN_MS, BENCH_OUTCOME, BENCH_UNIT_LOG, benchmarksUnit, controllerTarget, countOnce, cycle, rangeReaches, followVerified, fullCheckStatus, parseOptions, partSteps, RECORDER_LOG, recordJob, recordingPins, recordPending, RECORDS_ATTEMPTS, RECORDS_OUTCOME, RECORDS_UNIT_LOG, recordsUnit, statusText, TEST262_NEW_FAILS, type CountEffects, type Effects} from "./service.ts";
import {FULL_MD, measureJob, RUNS, type Bench, type Publisher} from "./bench.ts";
import {DELTA_FILE, serializeDelta} from "../records/delta.ts";
import {reopenIssue, type Gh} from "./revert.ts";
import {readCount, readState, writeState, newTask, type CountRecord, type Part} from "./state.ts";
import {BENCH_UNIT, recordsUnitName} from "./unit.ts";
import {GateResource} from "../gate/gate-resource.ts";
import {Git} from "./git.ts";
import {candidateEnvironmentFixture,candidateVersion,resolutionSubject,assertSessionClosed} from './run-environment-fixture.ts';
import {hostEnvironment} from '../gate/canonical-environment.ts';
import {nodeInstallation} from '../gate/toolchain-fixture.ts';
import {removable as makeRemovable} from '../gate/run-temporary.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
import { fixtureContract } from "../gate/verdict-contract-fixture.ts";
import { recordLandingFixture } from "../landing/verdict-fixture.ts";
import { measureWithLanding } from "./landing-verdict.ts";

type Harness = Effects & {
  lines: string[]; queue: StubQueue; submitted: StubQueue["submitted"]; withdrawn: string[]; told: { n: number; comment: string }[]; units: StubUnits;
  /** What the records units do in place of record-pending.ts (recordIn). */
  recorder: Recorder;
  /** What the benchmarks unit does in place of nts-bench (measureIn). */
  bench: Bench;
};

function harness(repo: Repository, gate: FakeGate, options: { now?: Date; recorder?: Recorder; applier?: Applier; queue?: StubQueue; units?: StubUnits; schedule?: Effects["schedule"]; idle?: boolean; memoryWaiter?: () => string | null; bench?: Bench; publisher?: Publisher; issue?: Effects["issue"] } = {}): Harness {
  const lines: string[] = [], told: { n: number; comment: string }[] = [];
  const queue = options.queue ?? stubQueue();
  return {
    layout: repo.layout,
    git: repo.git,
    gate,
    queue,
    // Core controls own a waiting agent; wide/benchmark controls select idle explicitly.
    memoryWaiter: options.memoryWaiter ?? (() => options.idle ? null : "fixture agent memory request waits"),
    restartTarget: () => null,
    reaches: () => true,
    submitted: queue.submitted,
    withdrawn: queue.withdrawn,
    units: options.units ?? stubUnits(),
    node: () => process.execPath,
    recorder: options.recorder ?? (() => ({ status: 0, output: "" })),
    checkout: (tree, commit) => checkoutIn(repo, tree)(commit),
    applier: options.applier ?? applyEveryRow,
    bench: options.bench ?? stubBench(),
    publisher: options.publisher ?? publishEveryRun,
    pins: join(repo.root, "pins"),
    push: commit => {
      const r = repo.git.try(["push", "-q", "origin", `${commit}:refs/heads/verified`]);
      return { ok: r.status === 0, line: r.status === 0 ? `pushed ${commit}` : r.stderr };
    },
    issue: (n, comment) => { told.push({ n, comment }); return options.issue?.(n, comment) ?? { ok: true, line: `issue #${n} is open again` }; },
    now: () => options.now ?? new Date(2026, 10, 6, 12, 0),
    log: line => lines.push(line),
    schedule: options.schedule ?? { nightly: "03:00" },
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

/**
 * Harnesses that stand for one machine at different times, as controllers
 * that restart find it: one landing queue, one set of units, one nts-bench.
 */
function machine(repo: Repository, gate: FakeGate, shared: { bench?: Bench } = {}): (now: Date, options?: { bench?: Bench }) => Harness {
  const units = stubUnits(), queue = stubQueue();
  return (now, options = {}) => harness(repo, gate, { now, units, queue, idle: true, bench: options.bench ?? shared.bench });
}

/**
 * The benchmarks unit ends, having done what its command line says: the
 * measurement its tree's own code runs (service.ts --benchmarks), with the
 * harness's nts-bench.
 */
function measureIn(fx: Harness): void {
  fx.units.finish(BENCH_UNIT, spec => {
    const job = parseOptions(spec.command.slice(2)).benchmarks;
    assert.ok(job, spec.command.join(" "));
    measureJob(spec.cwd, job, fx.bench);
  });
}

/** The part's records unit ends, and the next cycle applies what it recorded on main and submits it. */
async function recordAndApply(fx: Harness, part: Part = "core"): Promise<void> {
  recordIn(fx, part);
  assert.equal(await cycle(fx), "records", fx.lines.join("\n"));
}

const remoteVerified = (repo: Repository) => repo.git.run(["ls-remote", "origin", "refs/heads/verified"]).split("\t")[0] || null;
const verified = (repo: Repository) => repo.git.commit("refs/heads/verified");

test("housekeeping removes an aged sealed tree without following its link into a read-only store, then runs the core", async t => {
  const repo = repository(t), commit = repo.commit({"a.txt":"1\n"},"first");
  const fx = harness(repo, fakeGate(repo));
  const run = join(repo.layout.runs,"aged-sealed-run"), sealed = join(run,"tmp/oracle-dependencies/node-26/tree/pkg");
  const store = join(repo.root,"read-only-store"), file = join(store,"keep");
  mkdirSync(sealed,{recursive:true}); mkdirSync(store);
  writeFileSync(file,"the store stays untouched\n");
  writeFileSync(join(sealed,"input.js"),"export const value = 7;\n",{mode:0o444});
  symlinkSync(store,join(sealed,"store"));
  const old = new Date(fx.now().getTime()-4*86_400_000);
  utimesSync(run,old,old);
  try {
    for (const dir of [run,join(run,"tmp/oracle-dependencies"),sealed,store]) chmodSync(dir,0o555);
    chmodSync(file,0o444);
    assert.equal(await cycle(fx),"core");
    assert.equal(existsSync(run),false);
    assert.equal(lstatSync(store).mode&0o777,0o555,"the directory link was never followed");
    assert.equal(lstatSync(file).mode&0o777,0o444);
    assert.equal(readFileSync(file,"utf8"),"the store stays untouched\n");
    assert.equal(verified(repo),commit);
  } finally { makeRemovable(repo.root); }
});

test("housekeeping names a folder it cannot remove and continues to the other folders and core", async t => {
  const repo = repository(t), commit = repo.commit({"a.txt":"1\n"},"first");
  const fx = harness(repo, fakeGate(repo)), paths = ["aged-a","aged-b"].map(name=>join(repo.layout.runs,name));
  const old = new Date(fx.now().getTime()-4*86_400_000);
  for (const path of paths) { mkdirSync(path,{recursive:true}); writeFileSync(join(path,"input"),"old\n"); utimesSync(path,old,old); }
  const log = fx.log;
  fx.log = line => {
    log(line);
    // Release the filesystem obstruction on the actual failure report, so
    // the next folder and the core's new run can be written, in either order.
    if (line.startsWith("kept run ")) chmodSync(repo.layout.runs,0o755);
  };
  try {
    chmodSync(repo.layout.runs,0o555);
    assert.equal(await cycle(fx),"core");
    const kept = paths.filter(path=>existsSync(path));
    assert.equal(kept.length,1,"only the failed removal is left behind");
    assert.ok(fx.lines.some(line=>line.startsWith(`kept run ${kept[0]}:`)&&line.includes("EACCES")),fx.lines.join("\n"));
    assert.equal(verified(repo),commit);
  } finally { chmodSync(repo.layout.runs,0o755); makeRemovable(repo.root); }
});

test('benchmark ownership blocks wide work beyond the nightly idle deadline and releases it on completion',async t=>{
  for(const recorded of [false,true]){
    const repo=repository(t),first=repo.commit({'a.txt':'first'},'first'),gate=fakeGate(repo);
    const now=new Date('2026-11-06T12:00:00Z'),fx=harness(repo,gate,{now,idle:true});await cycle(fx);
    const state=readState(repo.layout.state);state.wide.since='2026-11-05T00:00:00Z';state.nightly='2026-11-05T00:00:00Z';
    const unit=recorded?'fixture-retained-bench':BENCH_UNIT;
    assert.equal(fx.units.start({name:unit,cwd:repo.root,command:['fixture benchmark'],log:join(repo.root,'bench.log')}),null);
    if(recorded)state.benchmarks_due={since:'2026-11-05T00:00:00Z',until:'2026-11-07T03:00:00Z',measuring:{commit:first,run:join(repo.root,'measuring'),at:now.toISOString(),job:{unit,outcome:join(repo.root,'bench.outcome.json'),at:now.toISOString(),starts:1}}};
    writeState(repo.layout.state,state);const before=gate.measured.length;
    assert.equal(await cycle(fx),'idle');assert.equal(gate.measured.length,before);
    assert.ok(readState(repo.layout.state).wide.waiting?.includes(unit));assert.equal(readState(repo.layout.state).core.waiting,undefined);
    fx.units.stop(unit);const released=readState(repo.layout.state);delete released.benchmarks_due;writeState(repo.layout.state,released);
    assert.equal(await cycle(fx),'wide');assert.ok(gate.measured.length>before);
  }
});

test('core and its probes continue while benchmarks hold wide work',async t=>{
  for(const route of ['core','probe'] as const){
    const repo=repository(t),gate=fakeGate(repo),fx=harness(repo,gate,{now:new Date('2026-11-06T12:00:00Z'),idle:true});
    repo.commit({'a.txt':'first'},'first');await cycle(fx);const latest=repo.commit({'a.txt':'new'},'new main');
    const state=readState(repo.layout.state);state.wide.since='2026-11-05T00:00:00Z';state.nightly='2026-11-05T00:00:00Z';
    if(route==='probe')state.core.last_run={commit:latest,run:'',verdict:'red',at:'2026-11-06T10:00:00Z',failed:['tests'],search:{result:'held control',at:'2026-11-06T10:00:00Z'}};
    writeState(repo.layout.state,state);
    assert.equal(fx.units.start({name:BENCH_UNIT,cwd:repo.root,command:['fixture benchmark'],log:join(repo.root,'bench.log')}),null);
    const before=gate.measured.length;assert.equal(await cycle(fx),'core');
    assert.ok(gate.measured.slice(before).some(row=>row.commit===latest&&row.label===(route==='core'?'core':'core-probe')));
    assert.ok(!gate.measured.slice(before).some(row=>row.label.startsWith('wide')));assert.ok(fx.units.running(BENCH_UNIT));
  }
});

test('an existing wide culprit retry waits for benchmarks and resumes after they leave',async t=>{
  const repo=repository(t),gate=fakeGate(repo),now=new Date('2026-11-06T12:00:00Z'),fx=harness(repo,gate,{now});
  const first=repo.commit({'a.txt':'first'},'first');await cycle(fx);
  const second=repo.commit({'a.txt':'second'},'second');await cycle(fx);
  const state=readState(repo.layout.state);
  state.wide.last_green={commit:first,run:'old-green',verdict:'green',at:now.toISOString(),failed:[]};
  state.wide.last_run={commit:second,run:'old-red',verdict:'red',at:now.toISOString(),failed:['integrity'],search:{result:'held control',at:'2026-11-06T10:00:00Z'}};
  writeState(repo.layout.state,state);
  assert.equal(fx.units.start({name:BENCH_UNIT,cwd:repo.root,command:['fixture benchmark'],log:join(repo.root,'bench.log')}),null);
  const before=gate.measured.length;assert.equal(await cycle(fx),'idle');assert.equal(gate.measured.length,before);
  fx.units.stop(BENCH_UNIT);assert.equal(await cycle(fx),'wide');
  assert.ok(gate.measured.slice(before).some(row=>row.label==='wide-probe'));
});

test('an unreadable benchmark unit refuses measurement by name',async t=>{
  const repo=repository(t),gate=fakeGate(repo);repo.commit({'a.txt':'first'},'first');
  const fx=harness(repo,gate,{idle:true}),running=fx.units.running;
  fx.units.running=name=>{if(name===BENCH_UNIT)throw Error('supplied manager failure');return running(name);};
  await assert.rejects(cycle(fx),error=>error instanceof ToolingInstrumentError&&error.kind==='tooling-setup'&&error.message.includes('cannot observe nightly benchmark unit')&&error.message.includes('supplied manager failure'));
  assert.equal(gate.measured.length,0);
});

test('completed records are applied while a benchmark unit is active',async t=>{
  const repo=repository(t),gate=fakeGate(repo),fx=harness(repo,gate,{recorder:newCase()});
  repo.commit(NEW_CASE,'new case');await cycle(fx);
  assert.equal(fx.units.start({name:BENCH_UNIT,cwd:repo.root,command:['fixture benchmark'],log:join(repo.root,'bench.log')}),null);
  const measured=gate.measured.length;recordIn(fx);
  assert.equal(await cycle(fx),'records');assert.equal(gate.measured.length,measured);
  assert.ok(readState(repo.layout.state).core.records?.submitted);
});

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

test("a fix landed during the red run is recorded before any search or issue reopening", async t => {
  const repo = repository(t), gate = fakeGate(repo), fx = harness(repo, gate);
  const good = repo.commit({ "src.txt": "base" }, "good");
  await cycle(fx);
  const bad = repo.commit({ "RED/typescript-c": "" }, "breaks compiler\n\nFixes #740");
  let fixed = "";
  const run = gate.run.bind(gate);
  gate.run = (commit, steps, label, ...rest) => {
    const result = run(commit, steps, label, ...rest);
    if (commit === bad && label === "core") fixed = repo.commit({ "RED/typescript-c": null }, "fix forward");
    return result;
  };
  await cycle(fx);
  const state = readState(repo.layout.state);
  assert.equal(state.core.last_run?.commit, bad);
  assert.match(state.core.last_run?.search?.result ?? "", new RegExp("fixed forward at " + fixed.slice(0,12) + ".*probe"));
  assert.deepEqual(fx.submitted, []);
  assert.deepEqual(fx.told, []);
  assert.deepEqual(state.culprits, []);
  const probes = gate.measured.filter(m => m.label === "core-probe");
  assert.deepEqual(probes.map(m => [m.commit,m.steps]), [[fixed,["typescript-c"]]]);
  assert.equal(verified(repo), good, "a step probe is not a complete core verdict");
  await cycle(fx);
  assert.equal(gate.measured.at(-1)?.commit, fixed);
  assert.equal(verified(repo), fixed, "the next core verifies newest main");
});

test("a partial fix during bisection reverts and reopens only the remaining culprit", async t => {
  const repo = repository(t), gate = fakeGate(repo), fx = harness(repo, gate);
  repo.commit({ "src.txt": "base" }, "good");
  await cycle(fx);
  const first = repo.commit({ "RED/tests": "" }, "breaks tests\n\nFixes #101");
  const bad = repo.commit({ "RED/typescript-c": "" }, "breaks compiler\n\nFixes #102");
  let fixed = "";
  const run = gate.run.bind(gate);
  gate.run = (commit, steps, label, ...rest) => {
    const result = run(commit, steps, label, ...rest);
    if (commit === first && label === "core-probe" && !fixed) fixed = repo.commit({ "RED/tests": null }, "fix tests forward");
    return result;
  };
  await cycle(fx);
  const state = readState(repo.layout.state), culprit = state.culprits[0]!;
  assert.deepEqual(state.culprits.map(c => [c.commit,c.steps]), [[bad,["typescript-c"]]]);
  assert.deepEqual(fx.told.map(told => told.n), [102]);
  assert.equal(fx.submitted.length, 1);
  assert.equal(repo.git.run(["rev-parse", culprit.revert! + "^"]), fixed);
  assertMessage(repo.git, culprit.revert!, /Newest main remained red/, /valid through/, /typescript-c/);
  const refreshed = gate.measured.findIndex(m => m.label === "core-probe" && m.commit === fixed);
  assert.ok(refreshed > 0);
  assert.ok(gate.measured.slice(refreshed + 1).every(m => m.steps.join() === "typescript-c"));
});

test("probe carry uses both endpoint rules and wide reach; unknown or non-forward reach cannot narrow", t => {
  const repo = repository(t);
  const base = repo.commit({ "src.txt": "base" }, "base");
  const tip = repo.commit({ "src.txt": "tip" }, "tip");
  const select = (rules: { name: string; steps: string[]; full?: boolean }[]) => (root: string, range: string) => {
    assert.equal(root, repo.git.cwd);
    assert.equal(range, base + ".." + tip);
    return { base, tip, checks: { steps: ["build"], interop: null }, views: [base,tip].map(revision => ({
      revision, catalogue: ["build","tests","dex"], checks: { steps: ["build"], interop: null },
      rules: rules.map(rule => ({ ...rule, paths: ["input"], arms: [] })),
    })) };
  };
  assert.equal(rangeReaches(repo.git,base,tip,["tests"],select([{name:"docs",steps:["build"]}])),false);
  assert.equal(rangeReaches(repo.git,base,tip,["tests"],select([{name:"reader",steps:["tests"]}])),true);
  assert.equal(rangeReaches(repo.git,base,tip,["dex"],select([{name:"wide reader",steps:["dex"]}])),true);
  assert.equal(rangeReaches(repo.git,base,tip,["dex"],select([{name:"policy",steps:[],full:true}])),true);
  assert.equal(rangeReaches(repo.git,base,tip,["unknown"],select([])),true);
  assert.equal(rangeReaches(repo.git,tip,base,["tests"],()=>{throw Error("non-forward history must not be selected");}),true);
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
  assert.match(readState(repo.layout.state).core.last_run?.search?.result ?? "", /^held: newest main .* could not be measured/);
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
  // The fixture's waiting agent holds wide, so that part is never green
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

test("a records run that adds test262 fail rows names them in a task line, with their full list beside the run", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const record = "results/test262/c/language.tsv", fail = "test/language/expressions/class/a.js", pass = "test/language/statements/for/b.js";
  const recorder: Recorder = (tree, _pin, run) => {
    const rows = [
      { kind: "test262", record, case: fail, key: fail, before: null, after: `${fail}\tfail\tuncaught Test262Error: #1`, sources: "0".repeat(64) },
      { kind: "test262", record, case: pass, key: pass, before: null, after: `${pass}\tpass\t`, sources: "0".repeat(64) },
    ];
    mkdirSync(join(tree, dirname(record)), { recursive: true });
    writeFileSync(join(tree, record), `# a test262 record\n${rows.map(row => row.after).join("\n")}\n`);
    writeFileSync(join(run, DELTA_FILE), serializeDelta({ version: 1, commit: null, headers: {}, rows }));
    return { status: 0, output: "" };
  };
  const fx = harness(repo, gate, { recorder });
  const commit = repo.commit({ "LOG/typescript-c": `  pending: ${fail} is not recorded in ${record} yet: fail: uncaught Test262Error: #1\n` }, "a case runs now");
  assert.equal(await cycle(fx), "core");
  await recordAndApply(fx);
  const state = readState(repo.layout.state), list = join(state.core.last_green!.run, TEST262_NEW_FAILS);
  const line = `- test262 records at ${commit.slice(0, 12)} added 1 fail row(s), cases that run now and fail, any of which may be a refusal turned wrong: `
    + `${record}: test/language/expressions 1. The full list is ${list}.`;
  assert.ok(fx.lines.includes(`TASK for an issue: ${line}`), fx.lines.join("\n"));
  assert.ok(state.tasks.some(task => task.line === line), "the task line is kept in the full check's status");
  assert.equal(readFileSync(list, "utf8"), `${record}\t${fail}\tuncaught Test262Error: #1\n`, "the full list names the one fail row, not the new pass");
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
  assert.equal(readState(repo.layout.state).core.records?.outcome, "recording");
  await recordAndApply(fx);
  const state = readState(repo.layout.state);
  assert.equal(state.core.records?.outcome, "submitted");
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
const answer = (state: "landed" | "refused" | "held" | "withdrawn", message: string, tip?: string) => ({ state, at: "2026-11-06T12:00:00.000Z", message, ...(tip ? { tip } : {}) });

for (const outcome of ["landed", "withdrawn", "waiting"] as const) {
  test(`a green core refreshes its previous records landing after the run: ${outcome}`, async t => {
    const repo = repository(t), gate = fakeGate(repo);
    const fx = harness(repo, gate, { recorder: newCase() });
    const first = repo.commit(NEW_CASE, "the first pending case");
    assert.equal(await cycle(fx), "core");
    await recordAndApply(fx);
    const previous = readState(repo.layout.state).core.records!;
    assert.equal(fx.queue.answer(previous.submitted!), "waiting");
    const next = repo.commit({ "later.txt": "another change\n" }, "another green core owes rows");
    const run = gate.run.bind(gate);
    gate.run = (commit, steps, label, ...rest) => {
      assert.equal(fx.queue.answer(previous.submitted!), "waiting", "the cycle saw it waiting before the core");
      if (outcome !== "waiting") fx.queue.answers.set(previous.submitted!, answer(outcome, "answered while the core ran", previous.submitted!));
      return run(commit, steps, label, ...rest);
    };
    assert.equal(await cycle(fx), "core");
    const current = readState(repo.layout.state).core.records!;
    if (outcome === "waiting") {
      assert.equal(current.commit, first);
      assert.equal(current.submitted, previous.submitted);
      assert.equal(current.settled, undefined);
      assert.equal(fx.units.specs.length, 1, "a waiting delta still prevents duplicate recording");
      assert.ok(!fx.units.running(recordsUnitName("core")));
    } else {
      assert.ok(fx.lines.some(line => line.includes(`records ${previous.submitted!.slice(0, 12)}`) && line.includes(outcome === "landed" ? "landed as" : "withdrawn:")), fx.lines.join("\n"));
      assert.equal(current.commit, next, "the new rows record in the cycle whose core observed the answer");
      assert.equal(current.outcome, "recording");
      assert.equal(fx.units.specs.length, 2);
      assert.ok(fx.units.running(recordsUnitName("core")));
    }
  });
}

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
  assert.equal(readState(repo.layout.state).core.records!.outcome, "failed", "refused, it is out of the queue, waiting to be applied again");
  const moved = repo.commit({ "elsewhere.txt": "x\n" }, "main moves on");
  assert.equal(await cycle(fx), "records", "applied again first, before the core takes the new main");
  const again = readState(repo.layout.state).core.records!;
  assert.deepEqual([again.attempts, again.base, again.answer, again.settled, again.outcome], [2, moved, undefined, undefined, "submitted"]);
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
  assert.deepEqual([landed.result, landed.answer?.state, typeof landed.settled, landed.outcome], ["landed as ffffffffffff", "landed", "string", "landed"]);
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
  // What the records are as the core starts, before its green run records anew.
  const run = fx.gate.run.bind(fx.gate);
  let atCore: string | undefined;
  fx.gate.run = (at, steps, label) => { atCore ??= readState(repo.layout.state).core.records?.outcome; return run(at, steps, label); };
  assert.equal(await cycle(fx), "core", "not applied again: the core takes the new main");
  assert.equal(atCore, "given-up");
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
  assert.deepEqual([records.submitted, records.settled, fx.submitted.length, records.outcome], [null, undefined, 0, "failed"]);
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
  assert.deepEqual([state.core.records?.result, state.core.records?.outcome, state.core.records?.delta, fx.submitted.length], ["wrote 1 record file(s) and no delta", "failed", undefined, 0]);
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
  assert.equal(new Git(repo.layout.records.core, repo.git.env).commit("HEAD"), commit);
  assert.equal(new Git(repo.layout.tree, repo.git.env).commit("HEAD"), third);
  await recordAndApply(fx);
  const records = readState(repo.layout.state).core.records!;
  assert.equal(records.commit, commit, "recorded at the run's commit");
  assert.equal(repo.git.run(["rev-parse", `${records.submitted}^`]), third, "applied on the newest main, in the records tree");
  assert.equal(new Git(repo.layout.records.core, repo.git.env).commit("HEAD"), records.submitted);
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
  assert.deepEqual([again.job!.starts, again.outcome], [2, "recording"]);
  assert.match(again.result, /^recording in nts-full-check-records-core since \S+, started again$/);
  // Gone again: given up, its rows pending for the next records run.
  fx.units.stop(unit);
  assert.equal(await cycle(fx), "idle");
  assert.equal(fx.units.specs.length, 2, "never a third time");
  const given = readState(repo.layout.state);
  assert.deepEqual([typeof given.core.records!.settled, given.core.records!.outcome], ["string", "given-up"]);
  assert.ok(given.tasks.some(one => one.line === `- The full check's core records at ${commit.slice(0, 12)} did not finish: ${unit} is gone and wrote no outcome, `
    + `started 2 time(s); see ${join(run, RECORDS_UNIT_LOG)}. Their rows stay pending for the next records run.`), JSON.stringify(given.tasks));
  repo.commit({ "later.txt": "x\n" }, "later");
  assert.equal(await cycle(fx), "core");
  assert.equal(fx.units.specs.length, 3, "the next green run records them anew");
  await recordAndApply(fx);
  assert.equal(fx.submitted.length, 1);
});

test("a records run that recorded nothing, or whose rows main has already, is nothing; one the landing check withdraws is withdrawn", async t => {
  const repo = repository(t);
  const nothing = harness(repo, fakeGate(repo), { recorder: recording({}) });
  repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(nothing), "core");
  recordIn(nothing);
  assert.equal(await cycle(nothing), "idle");
  assert.deepEqual([readState(repo.layout.state).core.records!.result, readState(repo.layout.state).core.records!.outcome], ["recorded nothing", "nothing"]);
  // Rows main has already: applied there, they leave nothing to commit.
  const there = harness(repo, fakeGate(repo), { recorder: newCase(), applier: (_tree, _delta, log) => { writeFileSync(log, "record-pending --apply: 0 row(s) applied, 1 already recorded, 0 skipped\n"); return { status: 0, output: "record-pending --apply: 0 row(s) applied, 1 already recorded, 0 skipped\n" }; } });
  repo.commit({ "b.txt": "b\n" }, "two");
  assert.equal(await cycle(there), "core");
  await recordAndApply(there);
  const already = readState(repo.layout.state).core.records!;
  assert.deepEqual([already.outcome, typeof already.settled], ["nothing", "string"]);
  assert.match(already.result, /^nothing left to commit on main/);
  // Submitted, then withdrawn by the landing check.
  const withdrawn = harness(repo, fakeGate(repo), { recorder: newCase() });
  repo.commit({ "c.txt": "c\n" }, "three");
  assert.equal(await cycle(withdrawn), "core");
  await recordAndApply(withdrawn);
  const submitted = readState(repo.layout.state).core.records!.submitted!;
  withdrawn.queue.answers.set(submitted, answer("withdrawn", "withdrawn before it was checked"));
  await cycle(withdrawn);
  const ended = readState(repo.layout.state).core.records!;
  assert.deepEqual([ended.outcome, ended.result, typeof ended.settled], ["withdrawn", "withdrawn: withdrawn before it was checked", "string"]);
});

test("a records unit that does not start is started once more, then given up", async t => {
  const repo = repository(t), units = stubUnits(), fx = harness(repo, fakeGate(repo), { recorder: newCase(), units });
  units.start = spec => { units.specs.push(spec); return "systemd-run exited 1: Failed to start transient service unit"; };
  repo.commit(NEW_CASE, "a new case");
  assert.equal(await cycle(fx), "core");
  assert.match(readState(repo.layout.state).core.records!.result, /^nts-full-check-records-core did not start: systemd-run exited 1/);
  assert.equal(readState(repo.layout.state).core.records!.outcome, "recording", "still the controller's to start once more");
  assert.equal(await cycle(fx), "idle");
  assert.equal(await cycle(fx), "idle");
  assert.equal(units.specs.length, 2);
  assert.equal(readState(repo.layout.state).core.records!.outcome, "given-up");
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

test("the wide steps follow verified when idle, without waiting for a clock slot", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const morning = harness(repo, gate, { now: new Date(2026, 10, 6, 9, 0), schedule: { nightly: "03:00" } });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(morning); // 03:00 was due, nothing verified yet: the core runs
  assert.equal(verified(repo), first);
  repo.commit({ "a.txt": "2\n" }, "on main, not verified yet");
  const later = harness(repo, gate, { now: new Date(2026, 10, 6, 10, 30), idle: true, schedule: { nightly: "03:00" } });
  assert.equal(await cycle(later), "wide");
  assert.deepEqual(gate.measured.at(-1), { commit: first, steps: ["integrity"], label: "wide" });
  assert.equal(readState(repo.layout.state).wide.last_green?.commit, first);
  assert.equal(await cycle(later), "core", "the slot is answered; the core takes main");
});

const BEFORE = new Date(2026, 10, 6, 23, 0), NIGHT = new Date(2026, 10, 7, 3, 30), NEXT_NIGHT = new Date(2026, 10, 8, 3, 30);

test("wide follows the latest verified at the gap boundary, without delaying core inside the gap", async t => {
  const repo = repository(t), gate = fakeGate(repo);
  const at = (hour: number) => harness(repo, gate, { now: new Date(2026, 10, 6, hour, 17), idle: true });
  const first = repo.commit({ "a.txt": "1\n" }, "first");
  assert.equal(await cycle(at(9)), "core");
  assert.equal(await cycle(at(9)), "wide");
  const second = repo.commit({ "a.txt": "2\n" }, "second");
  assert.equal(await cycle(at(10)), "core");
  assert.equal(verified(repo), second);
  assert.equal(await cycle(at(12)), "idle");
  assert.match(readState(repo.layout.state).wide.waiting!, /minimum wide gap/);
  assert.equal(await cycle(at(13)), "wide");
  assert.deepEqual(gate.measured.filter(row => row.label === "wide").map(row => row.commit), [first, second]);
  assert.equal(readState(repo.layout.state).wide.waiting, undefined);
  assert.equal(await cycle(at(14)), "idle");
  assert.equal(readState(repo.layout.state).benchmarks_due, undefined, "daytime wide does not request benchmarks");
});

test("queued landings and memory waiters leave the wide start owed until the machine is idle", async t => {
  const repo = repository(t), gate = fakeGate(repo), queue = stubQueue();
  let waiting: string | null = "agent memory request waits: fixture proof";
  const at = () => harness(repo, gate, { queue, idle: true, memoryWaiter: () => waiting });
  const commit = repo.commit({ "a.txt": "1\n" }, "first");
  assert.equal(await cycle(at()), "core");
  queue.submit(commit);
  assert.equal(await cycle(at()), "idle");
  assert.equal(readState(repo.layout.state).wide.waiting, "a fixture landing is queued");
  queue.answers.set(commit, { state: "landed", at: at().now().toISOString(), message: "landed" });
  assert.equal(await cycle(at()), "idle");
  assert.equal(readState(repo.layout.state).wide.waiting, waiting);
  assert.equal(readState(repo.layout.state).wide.last_run, undefined);
  waiting = null;
  assert.equal(await cycle(at()), "wide");
  assert.equal(gate.measured.filter(row => row.label === "wide").length, 1);
});

test("nightly wide repeats unchanged verified inside the gap and blocks a new benchmark until idle", async t => {
  const repo = repository(t), gate = fakeGate(repo), units = stubUnits(), queue = stubQueue();
  let waiting: string | null = null;
  const at = (now: Date) => harness(repo, gate, { now, units, queue, idle: true, memoryWaiter: () => waiting });
  repo.commit({ "a.txt": "1\n" }, "first");
  assert.equal(await cycle(at(BEFORE)), "core");
  assert.equal(await cycle(at(new Date(2026, 10, 7, 2, 59))), "wide");
  waiting = "agent memory request waits: fixture proof";
  assert.equal(await cycle(at(NIGHT)), "idle");
  assert.equal(units.specs.length, 0, "nightly benchmark cannot skip its wide attempt");
  assert.match(readState(repo.layout.state).benchmarks_due!.waiting!, /nightly wide run waits/);
  waiting = null;
  assert.equal(await cycle(at(NIGHT)), "wide");
  assert.equal(gate.measured.filter(row => row.label === "wide").length, 2);
  assert.equal(await cycle(at(NIGHT)), "benchmarks");
  assert.equal(units.specs.at(-1)!.name, BENCH_UNIT);
});

test("a busy night enters normal wide admission at its deadline, while daytime remains idle-only", async t => {
  const repo = repository(t), gate = fakeGate(repo), queue = stubQueue(), units = stubUnits();
  const at = (now: Date) => harness(repo, gate, { now, queue, units, memoryWaiter: () => "agent memory request waits" });
  const first = repo.commit({ "a.txt": "1\n" }, "first");
  assert.equal(await cycle(at(BEFORE)), "core");
  queue.submit(first);
  assert.equal(await cycle(at(NIGHT)), "idle");
  const origin = readState(repo.layout.state).wide.since;
  const deadline = at(new Date(2026, 10, 7, 5));
  assert.equal(await cycle(deadline), "wide", "a restarted controller keeps the original night's deadline");
  assert.equal(readState(repo.layout.state).wide.since, origin);
  assert.ok(deadline.lines.some(line => line.includes("nightly wide idle deadline passed") && line.includes("full-check priority")));
  assert.equal(gate.measured.at(-1)!.label, "wide", "uses the normal full-check measurement path");
  repo.commit({ "a.txt": "2\n" }, "second");
  const daytime = at(new Date(2026, 10, 7, 12));
  assert.equal(await cycle(daytime), "core");
  assert.equal(await cycle(daytime), "benchmarks", "the fulfilled night's existing benchmark request still proceeds");
  assert.equal(await cycle(daytime), "idle");
  assert.equal(readState(repo.layout.state).wide.last_run!.commit, first);
});

test("a benchmark session's budget answers the night once, with or without a retained record", async t => {
  for (const kept of [true, false]) {
    const repo = repository(t), gate = fakeGate(repo), measured = stubBench();
    let attempts = 0;
    const bench: Bench = (tree, run) => {
      attempts++;
      const result = kept ? measured(tree, run) : { admitted: true as const, status: 124 };
      assert.ok(result.admitted);
      return { ...result, status: 124, budget: { milliseconds: 10, unreached: ["never-started"] } };
    };
    const at = machine(repo, gate, { bench });
    repo.commit({ "a.txt": "verified\n" }, "verified");
    await cycle(at(BEFORE));
    const night = at(NIGHT);
    await cycle(night);
    await cycle(night);
    measureIn(night);
    assert.equal(await cycle(night), "benchmarks");
    const state = readState(repo.layout.state);
    assert.equal(state.benchmarks_due, undefined);
    assert.deepEqual(state.bench!.budget, { milliseconds: 10, unreached: ["never-started"] });
    assert.ok(night.lines.some(line => line.includes("session time budget exhausted; unreached: never-started")));
    assert.equal(Boolean(state.bench!.record), kept);
    await cycle(night);
    assert.equal(attempts, 1, "a budget is an outcome, so the controller never repeats that session");
  }
});

test("the nightly slot makes the benchmarks due; nts-bench measures verified in a unit and a tree of its own, and its record is published on the newest main", async t => {
  const repo = repository(t), gate = fakeGate(repo), bench = stubBench({ slower: ["awfy-list", "richards"] }), at = machine(repo, gate, { bench });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE)); // the 22:00 slot finds nothing verified; the core verifies main
  assert.equal(verified(repo), first);
  const night = at(NIGHT);
  assert.equal(await cycle(night), "wide");
  assert.equal(bench.calls.length, 0, "the slot makes the benchmarks due; it does not run them");
  assert.equal(await cycle(night), "benchmarks", "built at verified, and its unit started");
  assert.deepEqual(gate.measured.map(m => `${m.label} ${m.steps.join(" ")}`).slice(-2), ["wide integrity", "bench-build build"], "nts-bench is built from the commit it measures");
  const measuring = readState(repo.layout.state).benchmarks_due!.measuring!;
  assert.ok(night.units.running(BENCH_UNIT));
  assert.equal(readFileSync(join(measuring.run, "nts-bench"), "utf8"), `nts-bench at ${first}\n`, "with the run's own copy of that build, which the next core run cannot build over");
  assert.equal(new Git(repo.layout.bench, repo.git.env).commit("HEAD"), first, "in the bench tree, at verified");
  // Main moves on while it measures.
  const moved = repo.commit({ "b.txt": "2\n" }, "lands while it measures");
  measureIn(night);
  assert.deepEqual(bench.calls, [repo.layout.bench]);
  assert.equal(await cycle(night), "benchmarks", "the night has its answer, and its record is published");
  const state = readState(repo.layout.state), results = state.bench!.submitted!;
  assert.equal(state.benchmarks_due, undefined);
  assert.deepEqual([existsSync(join(measuring.run, "nts-bench")), existsSync(state.bench!.record!), existsSync(join(measuring.run, BENCH_OUTCOME))], [false, true, true],
    "its copy of nts-bench goes once the unit ended; its record and outcome stay with its logs");
  assert.deepEqual([state.bench?.commit, state.bench?.measured, state.bench?.outcome, state.bench?.attempts, state.bench?.base], [first, true, "submitted", 1, moved]);
  assert.deepEqual(night.submitted, [{ commit: results, first: false }]);
  assert.equal(repo.git.run(["rev-parse", `${results}^`]), moved, "published on the newest main, not on verified");
  assert.deepEqual(repo.git.run(["diff", "--name-only", moved, results]).split("\n"), [FULL_MD, `${RUNS}/${basename(state.bench!.record!)}`]);
  assert.equal(readFileSync(state.bench!.record!, "utf8"), repo.git.output(["show", `${results}:${RUNS}/${basename(state.bench!.record!)}`]), "the record as nts-bench kept it");
  assertMessage(repo.git, results, /^results: retain benchmark run /);
  assert.equal(repo.git.commit(`refs/full-check/benchmarks/${first.slice(0, 12)}`), results, "kept reachable until it lands");
  assert.ok(night.lines.some(line => line.includes("TASK") && line.includes("2 benchmark row(s) slower than their own best") && line.includes("awfy-list, richards")), night.lines.join("\n"));
  assert.deepEqual(state.bench?.slower, ["awfy-list", "richards"], "as main's page marks them");
  // It lands; the next night, verified unchanged, measures nothing again.
  night.queue.answers.set(results, answer("landed", "LANDED", "f".repeat(40)));
  const next = at(NEXT_NIGHT);
  await cycle(next);
  assert.deepEqual([readState(repo.layout.state).bench?.result, readState(repo.layout.state).bench?.outcome, readState(repo.layout.state).bench?.measured], ["landed as ffffffffffff", "landed", true]);
  assert.equal(bench.calls.length, 1);
  assert.ok(next.lines.some(line => line.includes("already measured")), next.lines.join("\n"));
});

test("a controller that restarts while nts-bench measures adopts its unit by name, and the core runs beside it; a unit gone without an outcome is started once more, then the night is given up", async t => {
  const repo = repository(t), gate = fakeGate(repo), bench = stubBench(), at = machine(repo, gate, { bench });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  assert.equal(await cycle(at(NIGHT)), "wide");
  assert.equal(await cycle(at(NIGHT)), "benchmarks");
  const { job, run } = readState(repo.layout.state).benchmarks_due!.measuring!;
  assert.deepEqual(job, { unit: BENCH_UNIT, outcome: join(run, BENCH_OUTCOME), at: job!.at, starts: 1 }, "the state names the unit and its outcome");
  // A controller that restarts finds it measuring, and runs the core on the newest main beside it.
  const after = at(new Date(2026, 10, 7, 4, 0)), moved = repo.commit({ "b.txt": "2\n" }, "lands while it measures");
  assert.equal(await cycle(after), "core");
  assert.equal(gate.measured.at(-1)!.commit, moved);
  assert.equal(after.units.specs.length, 1, "no second benchmarks unit");
  assert.equal(await cycle(after), "idle", "nothing holds it, and nothing waits for it");
  // Stopped by hand part way: gone, with no outcome. Started once more, in its tree set up afresh.
  writeFileSync(join(repo.layout.bench, "half-run.txt"), "x\n");
  after.units.stop(BENCH_UNIT);
  assert.equal(await cycle(after), "idle");
  assert.equal(after.units.specs.length, 2, "started once more");
  assert.equal(existsSync(join(repo.layout.bench, "half-run.txt")), false);
  assert.equal(new Git(repo.layout.bench, repo.git.env).commit("HEAD"), first, "at the commit it measures, not the newest verified");
  assert.equal(readState(repo.layout.state).benchmarks_due!.measuring!.job!.starts, 2);
  // Gone again: the night is given up as a task.
  after.units.stop(BENCH_UNIT);
  assert.equal(await cycle(after), "benchmarks");
  assert.equal(after.units.specs.length, 2, "never a third time");
  const given = readState(repo.layout.state);
  assert.equal(given.benchmarks_due, undefined);
  assert.deepEqual([given.bench?.outcome, given.bench?.measured], ["interrupted", false]);
  assert.ok(given.tasks.some(one => one.line === `- The nightly benchmarks at ${first.slice(0, 12)} did not finish: ${BENCH_UNIT} is gone and wrote no outcome, `
    + `started 2 time(s); see ${join(run, BENCH_UNIT_LOG)}. The next nightly slot measures again.`), JSON.stringify(given.tasks));
  assert.equal(bench.calls.length, 0);
});

test("a refused results commit is published again on the newest main, a held one at once; past its attempts it is a task", async t => {
  const repo = repository(t), gate = fakeGate(repo), at = machine(repo, gate, { bench: stubBench() });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  const night = at(NIGHT);
  await cycle(night);
  await cycle(night);
  measureIn(night);
  assert.equal(await cycle(night), "benchmarks");
  const published = readState(repo.layout.state).bench!.submitted!;
  night.queue.answers.set(published, answer("refused", `${published.slice(0, 12)} conflicts with main in ${FULL_MD}`));
  assert.equal(await cycle(night), "idle", "on the main it was published on, it would be refused the same way");
  assert.equal(readState(repo.layout.state).bench!.outcome, "failed");
  const moved = repo.commit({ "elsewhere.txt": "x\n" }, "main moves on");
  assert.equal(await cycle(night), "benchmarks", "published again first, before the core takes the new main");
  const again = readState(repo.layout.state).bench!;
  assert.deepEqual([again.attempts, again.base, again.answer, again.settled, again.outcome], [2, moved, undefined, undefined, "submitted"]);
  assert.equal(repo.git.run(["rev-parse", `${again.submitted}^`]), moved, "on the newest main");
  assert.equal(repo.git.commit(`refs/full-check/benchmarks/${first.slice(0, 12)}`), again.submitted);
  assert.ok(night.lines.some(line => line.includes(`refused: ${published.slice(0, 12)} conflicts with main`) && line.includes(`its record is published again on main ${moved.slice(0, 12)}`)), night.lines.join("\n"));
  night.queue.answers.set(again.submitted!, answer("held", "held: the check could not finish"));
  assert.equal(await cycle(night), "benchmarks", "a held one is published again at once");
  assert.deepEqual(night.withdrawn, [again.submitted], "withdrawn first, so it never lands behind its replacement");
  const third = readState(repo.layout.state).bench!;
  assert.equal(third.attempts, RECORDS_ATTEMPTS);
  night.queue.answers.set(third.submitted!, answer("refused", "red: records FAIL"));
  repo.commit({ "later.txt": "x\n" }, "main moves on again");
  assert.equal(await cycle(night), "core", "not published again: the core takes the new main");
  const given = readState(repo.layout.state);
  assert.deepEqual([typeof given.bench?.settled, given.bench?.outcome], ["string", "given-up"]);
  assert.ok(given.tasks.some(one => one.line === `- The nightly benchmark run at ${first.slice(0, 12)} did not land: refused: red: records FAIL; not published again: ${RECORDS_ATTEMPTS} attempt(s) made. `
    + `Its record ${third.record} is kept with its run's logs; publish it on main with tooling/bench/run-record.ts publish.`), JSON.stringify(given.tasks));
  assert.equal(night.submitted.length, RECORDS_ATTEMPTS);
});

test("a publication that fails is made again once main moves, and a record main has already leaves nothing to publish", async t => {
  const repo = repository(t), gate = fakeGate(repo), units = stubUnits(), queue = stubQueue(), bench = stubBench();
  let publisher: Publisher = (_tree, _record, log) => { writeFileSync(log, "schema: no such column\n"); return { status: 1, output: "schema: no such column\n" }; };
  const at = (now: Date) => harness(repo, gate, { now, units, queue, bench, idle: true, publisher: (tree, record, log) => publisher(tree, record, log) });
  repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  const night = at(NIGHT);
  await cycle(night);
  await cycle(night);
  measureIn(night);
  assert.equal(await cycle(night), "benchmarks");
  const failed = readState(repo.layout.state).bench!;
  assert.deepEqual([failed.outcome, failed.submitted, failed.attempts], ["failed", null, 1]);
  assert.match(failed.result, /^run-record\.ts publish exited 1 on main [0-9a-f]{12} \(attempt 1\); see /);
  // main moves; main already has the record and its page, as a hand publication would leave it.
  publisher = (tree, record, log) => { writeFileSync(log, `${join(tree, RUNS, basename(record))}\n`); return { status: 0, output: "" }; };
  repo.commit({ "b.txt": "2\n" }, "main moves on");
  assert.equal(await cycle(night), "benchmarks");
  const nothing = readState(repo.layout.state).bench!;
  assert.deepEqual([nothing.outcome, typeof nothing.settled, nothing.attempts], ["nothing", "string", 2]);
  assert.match(nothing.result, /^nothing left to publish on main/);
});

test("one night's run is in flight at a time: a night due while the last run waits to land measures once it lands", async t => {
  const repo = repository(t), gate = fakeGate(repo), at = machine(repo, gate, { bench: stubBench() });
  repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  const night = at(NIGHT);
  await cycle(night);
  await cycle(night);
  measureIn(night);
  assert.equal(await cycle(night), "benchmarks");
  const published = readState(repo.layout.state).bench!.submitted!;
  // It waits in the landing queue past the next night, and verified moves meanwhile.
  const second = repo.commit({ "b.txt": "2\n" }, "two");
  assert.equal(await cycle(night), "core");
  assert.equal(verified(repo), second);
  const next = at(NEXT_NIGHT);
  assert.equal(await cycle(next), "idle", "a queued results landing holds the nightly wide start");
  assert.equal(next.units.specs.length, 1);
  assert.match(readState(repo.layout.state).benchmarks_due!.waiting!, /^the nightly wide run waits: a fixture landing is queued$/);
  next.queue.answers.set(published, answer("landed", "LANDED", "e".repeat(40)));
  assert.equal(await cycle(next), "wide", "landed, the nightly wide attempt runs first");
  assert.equal(await cycle(next), "benchmarks", "then the night measures");
  assert.equal(next.units.specs.length, 2);
  assert.equal(readState(repo.layout.state).benchmarks_due!.measuring!.commit, second);
});

test("a nightly slot that comes while a night's run measures does not replace it, and is answered once it ends", async t => {
  const repo = repository(t), gate = fakeGate(repo), at = machine(repo, gate, { bench: stubBench() });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  const night = at(NIGHT);
  await cycle(night);
  await cycle(night);
  const answered = readState(repo.layout.state).nightly;
  const next = at(NEXT_NIGHT);
  assert.equal(await cycle(next), "idle", "the next nightly wide attempt waits for the existing benchmark unit");
  const still = readState(repo.layout.state);
  assert.deepEqual([still.nightly, still.benchmarks_due?.measuring?.commit], [answered, first], "the run measures on, and the slot waits for it");
  assert.ok(!next.lines.some(line => line.includes("replaced the night")), next.lines.join("\n"));
  measureIn(next);
  assert.equal(await cycle(next), "benchmarks");
  assert.equal(await cycle(next), "idle", "the completed benchmark's newly queued record still holds the wide start");
  assert.match(readState(repo.layout.state).wide.waiting!,/a fixture landing is queued/);
  assert.ok(next.lines.some(line => line.includes(`already measured verified ${first.slice(0, 12)}`)), next.lines.join("\n"));
  assert.notEqual(readState(repo.layout.state).nightly, answered, "answered once the run ended");
});

test("only a run that kept a record counts as measured: one that kept none ends the night as a task, and the next night measures the same verified", async t => {
  const repo = repository(t), gate = fakeGate(repo), at = machine(repo, gate);
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  const night = at(NIGHT, { bench: stubBench({ noRecord: true }) });
  assert.equal(await cycle(night), "wide");
  assert.equal(await cycle(night), "benchmarks");
  measureIn(night);
  assert.equal(await cycle(night), "benchmarks", "the night has its answer");
  const ended = readState(repo.layout.state);
  assert.equal(ended.bench?.outcome, "no-record");
  assert.equal(ended.bench?.measured, false);
  assert.match(ended.bench!.result, /^nts-bench exited 1: nts-bench committed no run record$/);
  assert.equal(ended.benchmarks_due, undefined);
  assert.ok(ended.tasks.some(one => one.line.includes("kept no run record")), JSON.stringify(ended.tasks));
  const bench = stubBench(), next = at(NEXT_NIGHT, { bench });
  assert.equal(await cycle(next), "wide", "the nightly attempt repeats unchanged verified");
  assert.equal(await cycle(next), "benchmarks", "nothing was measured, so the next night measures the same commit");
  measureIn(next);
  assert.equal(await cycle(next), "benchmarks");
  assert.equal(bench.calls.length, 1);
  assert.deepEqual([readState(repo.layout.state).bench?.commit, readState(repo.layout.state).bench?.measured], [first, true]);
});

test("an attempt the measurement lock does not admit keeps nothing and leaves the benchmarks due, asked again later; a night that never ran is replaced by the next and says what held it", async t => {
  const repo = repository(t), gate = fakeGate(repo);
  const refusal = "with-lock: pid 4242 is measuring; not starting another";
  const bench = stubBench({ refuse: [refusal, refusal] }), at = machine(repo, gate, { bench });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  const night = at(NIGHT);
  assert.equal(await cycle(night), "wide");
  assert.equal(await cycle(night), "benchmarks");
  measureIn(night);
  assert.equal(await cycle(night), "idle", "not admitted, the cycle goes on");
  const waiting = readState(repo.layout.state);
  assert.equal(bench.calls.length, 1);
  assert.deepEqual([waiting.benchmarks_due?.waiting, waiting.benchmarks_due?.measuring], [`not admitted: ${refusal}`, undefined]);
  assert.equal(waiting.bench, undefined, "an attempt that started nothing ends nothing");
  assert.deepEqual(readdirSync(repo.layout.runs).filter(name => /^bench-[0-9a-f]{12}-\d+$/.test(name)), [], "nothing of it is kept");
  assert.equal(await cycle(night), "idle", "and it is not asked again at once");
  assert.equal(night.units.specs.length, 1);
  const later = at(new Date(NIGHT.getTime() + BENCH_ASK_AGAIN_MS));
  assert.equal(await cycle(later), "benchmarks", "asked again later");
  measureIn(later);
  assert.equal(await cycle(later), "idle");
  assert.equal(bench.calls.length, 2);
  // The next nightly slot comes first: it replaces the night, saying what held it, and measures.
  const next = at(NEXT_NIGHT);
  assert.equal(await cycle(next), "wide", "nightly wide comes before a new benchmark unit");
  assert.equal(await cycle(next), "benchmarks");
  assert.ok(next.lines.some(line => line.includes(`not run: not admitted: ${refusal}; the nightly slot at`) && line.includes("replaced the night")), next.lines.join("\n"));
  measureIn(next);
  assert.equal(await cycle(next), "benchmarks");
  const measured = readState(repo.layout.state);
  assert.deepEqual([measured.bench?.outcome, measured.bench?.commit, measured.bench?.measured], ["submitted", first, true], "measured, and its record submitted");
});

test("a nightly slot the controller first reaches hours later still makes the benchmarks due", async t => {
  const repo = repository(t), gate = fakeGate(repo), bench = stubBench(), at = machine(repo, gate, { bench });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  assert.equal(await cycle(at(BEFORE)), "core");
  // Busy from before 03:00 until 10:30 (a culprit search, say): one missed night is still due.
  const late = at(new Date(2026, 10, 7, 10, 30));
  assert.equal(await cycle(late), "wide");
  assert.ok(readState(repo.layout.state).benchmarks_due, "the 03:00 night is due all the same");
  assert.equal(await cycle(late), "benchmarks");
  measureIn(late);
  assert.equal(await cycle(late), "benchmarks");
  assert.equal(readState(repo.layout.state).bench?.commit, first);
  assert.equal(bench.calls.length, 1);
});

test("the core goes first while the benchmarks are due, and they then measure the newest verified", async t => {
  const repo = repository(t), gate = fakeGate(repo), bench = stubBench(), at = machine(repo, gate, { bench });
  repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  const night = at(NIGHT);
  assert.equal(await cycle(night), "wide");
  const second = repo.commit({ "a.txt": "2\n" }, "landed while the benchmarks wait");
  assert.equal(await cycle(night), "core");
  assert.equal(night.units.specs.length, 0);
  assert.equal(verified(repo), second);
  assert.equal(await cycle(night), "benchmarks");
  measureIn(night);
  await cycle(night);
  assert.equal(readState(repo.layout.state).bench?.commit, second);
});

test("an attempt from before the benchmarks ran in a unit, which a stopped controller cut short, is tried again in a unit", async t => {
  const repo = repository(t), gate = fakeGate(repo), at = machine(repo, gate, { bench: stubBench() });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(at(BEFORE));
  const state = readState(repo.layout.state);
  state.nightly = NIGHT.toISOString();
  state.wide.last_run = { commit: first, run: "/previous-wide", at: NIGHT.toISOString(), verdict: "green", failed: [] };
  state.benchmarks_due = { since: NIGHT.toISOString(), until: NEXT_NIGHT.toISOString(), measuring: { commit: first, at: NIGHT.toISOString(), run: join(repo.layout.runs, "bench-old") }, interrupted: 1 } as never;
  writeFileSync(repo.layout.state, JSON.stringify(state));
  const after = at(new Date(2026, 10, 7, 4, 0));
  assert.equal(await cycle(after), "benchmarks", "tried again, in a unit");
  assert.ok(after.lines.some(line => line.includes(`the attempt from ${NIGHT.toISOString()} was cut short by a stopped controller, and is tried again`)), after.lines.join("\n"));
  assert.equal(readState(repo.layout.state).benchmarks_due!.measuring!.job!.unit, BENCH_UNIT);
});

test("the benchmarks unit's command is the job its own tree's service.ts parses, with a hang guard, and the session's history is the gate target's", t => {
  const repo = repository(t), run = join(repo.root, "run"), commit = "a".repeat(40), tree = repo.layout.bench;
  const spec = benchmarksUnit(repo.layout, { commit, run }, "/node");
  const job = { commit, run, bench: join(run, "nts-bench"), history: join(repo.layout.target, "gate-costs"), outcome: join(run, BENCH_OUTCOME) };
  assert.deepEqual(spec, { name: "nts-full-check-bench", cwd: tree, log: join(run, BENCH_UNIT_LOG), properties: ["RuntimeMaxSec=8h"],
    command: ["/node", join(tree, "tooling/full-check/service.ts"), "--benchmarks", `--commit=${commit}`, `--run=${run}`, `--bench=${job.bench}`, `--history=${job.history}`, `--outcome=${job.outcome}`] });
  assert.deepEqual(parseOptions(spec.command.slice(2)).benchmarks, job);
  assert.throws(() => parseOptions(["--benchmarks", `--commit=${commit}`]), /--benchmarks takes --commit, --run, --bench, --history and --outcome, all of them/);
  assert.throws(() => parseOptions([...spec.command.slice(2), "--pin=/pins/x/nts"]), /--pin is not --benchmarks's/);
  assert.throws(() => parseOptions(["--benchmarks", "--record=core", ...spec.command.slice(3)]), /each a command of its own/);
  assert.throws(() => parseOptions(["--bench=/x"]), /--bench are for --record or --benchmarks/);
});

/** The hourly count's effects over the scratch repository's layout: a green machine, an empty cache, unless a test says otherwise. */
function counting(repo: Repository, options: Partial<CountEffects> = {}): CountEffects & { lines: string[] } {
  const lines: string[] = [];
  return {
    count: () => ({ verdict: "PASS", red: [], notes: [], removable: [], stoppable: [] }),
    sweep: () => [],
    stopSlices: () => [],
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
    count: () => { order.push("count"); return { verdict: "FAIL", red: ["branch x (on the machine): named by no open issue"], notes: ["not counted: GitHub's branches"], removable: [], stoppable: [] }; },
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
  assert.deepEqual(parseOptions(["--wide-at=16:00,10:00", "--nightly-at=02:30"]).schedule, { nightly: "02:30" });
  assert.deepEqual(parseOptions(["--bench-wait=240"]).ignored, ["--bench-wait=240"], "a unit written before the benchmarks stayed due until the next nightly slot still starts");
  assert.deepEqual(parseOptions([]).ignored, []);
  assert.deepEqual(parseOptions(["--wide-at=16:00,10:00"]).ignored, ["--wide-at=16:00,10:00"], "old installed units start without restoring clock slots");
  assert.throws(() => parseOptions(["--wide-at=25:00"]), /not a time of day/);
  assert.throws(() => parseOptions(["--bogus"]), /unknown argument/);
});

test("the stand-in tree is a worktree of the scratch repository", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const commit = repo.commit({ "a.txt": "1\n" }, "one");
  gate.run(commit, ["tests"], "check");
  assert.equal(new Git(repo.layout.tree, repo.git.env).run(["rev-parse", "HEAD"]), commit);
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
    const at = new Git(tree, repo.git.env).commit("HEAD")!; linked.push(at);
    if (at === second) throw new Error("dependency-inputs.ts --offline: a package is not in the registry cache");
  };
  // Inputs that cannot be linked keep the code that runs: the tree goes back, its own inputs linked again.
  assert.equal(followVerified(repo.git, layout, repo.dir, refuse), false);
  assert.equal(repo.git.commit("HEAD"), first);
  assert.deepEqual(linked, [second, first]);
  linked.length = 0;
  assert.equal(followVerified(repo.git, layout, repo.dir, tree => { linked.push(new Git(tree, repo.git.env).commit("HEAD")!); }), true);
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
  assert.equal(spawnSync("flock", ["--shared", "--nonblock", "8"], {env:fixtureEnvironment(t), stdio: ["ignore", "ignore", "inherit", null, null, null, null, null, count] }).status, 0);
  const linked: string[] = [], link = (tree: string) => { linked.push(new Git(tree, repo.git.env).commit("HEAD")!); };
  assert.equal(followVerified(repo.git, layout, repo.dir, link), false);
  assert.deepEqual([repo.git.commit("HEAD"), linked], [first, []], "the tree does not move while the count reads it");
  closeSync(count);
  assert.equal(followVerified(repo.git, layout, repo.dir, link), true);
  assert.deepEqual([repo.git.commit("HEAD"), linked], [second, [second]]);
  const after = GateResource.tryAcquire(layout.controllerLock);
  assert.ok(after, "and the controller let it go");
  after.close();
});

test("a pending restart waits for the controller lock without starting a run or recording a hold", async t => {
  const repo=repository(t),first=repo.commit({"a.txt":"1\n"},"first"),second=repo.commit({"a.txt":"2\n"},"second");
  repo.git.run(["branch","verified",second]);
  repo.git.run(["checkout","-q","--detach",first]);
  const gate=fakeGate(repo),fx=harness(repo,gate);
  fx.layout={...repo.layout,controller:repo.dir};
  fx.restartTarget=()=>controllerTarget(repo.git,fx.layout,repo.dir);
  const count=GateResource.tryAcquire(fx.layout.controllerLock);
  assert.ok(count);
  try {
    assert.equal(followVerified(repo.git,fx.layout,repo.dir,()=>assert.fail("locked")),false);
    assert.equal(await cycle(fx),"restart");
    assert.equal(await cycle(fx),"restart");
    assert.deepEqual(gate.measured,[]);
    const state=readState(repo.layout.state);
    assert.equal(state.core.last_run,undefined);
    assert.equal(state.wide.last_run,undefined);
    assert.deepEqual(state.now,{doing:"restarting",commit:second,since:fx.now().toISOString()});
    const status=fullCheckStatus(state,{main:second,verified:second,unverified:[],landedAt:()=>fx.now().toISOString(),controller:{pid:42,alive:true},count:null,now:fx.now()});
    assert.ok(statusText(status).includes(`restarting for verified ${second}`));
    assert.equal(fx.lines.filter(line=>line.startsWith("restarting for verified")).length,1);
  } finally { count.close(); }
  assert.equal(followVerified(repo.git,fx.layout,repo.dir,()=>{}),true);
  assert.equal(controllerTarget(repo.git,fx.layout,repo.dir),null);
});

for(const part of ["core","wide"] as const)test(`verified moving during ${part} preparation restarts before the gate launch`,async t=>{
  const repo=repository(t),first=repo.commit({"a.txt":"1\n"},"first"),second=repo.commit({"a.txt":"2\n"},"second");
  repo.git.run(["branch","verified",first]);
  repo.git.run(["checkout","-q","--detach",first]);
  const gate=fakeGate(repo),fx=harness(repo,gate,{idle:part==="wide"});
  fx.layout={...repo.layout,controller:repo.dir};
  fx.restartTarget=()=>controllerTarget(repo.git,fx.layout,repo.dir);
  const steps=gate.steps;
  gate.steps=commit=>{repo.git.run(["update-ref","refs/heads/verified",second]);return steps(commit);};
  assert.equal(await cycle(fx),"restart");
  assert.deepEqual(gate.measured,[]);
  assert.equal(readState(repo.layout.state)[part].last_run,undefined);
  assert.equal(readState(repo.layout.state).now?.doing,"restarting");
});

test("verified moving before a culprit probe restarts without a probe or a false held result",async t=>{
  const repo=repository(t),first=repo.commit({"a.txt":"1\n"},"first"),gate=fakeGate(repo),fx=harness(repo,gate);
  assert.equal(await cycle(fx),"core");
  const red=repo.commit({"RED/tests":"red\n"},"red");
  repo.git.run(["checkout","-q","--detach",first]);
  fx.layout={...repo.layout,controller:repo.dir};
  fx.restartTarget=()=>controllerTarget(repo.git,fx.layout,repo.dir);
  const steps=gate.steps;let preparations=0;
  gate.steps=commit=>{if(++preparations===2)repo.git.run(["update-ref","refs/heads/verified",red]);return steps(commit);};
  assert.equal(await cycle(fx),"restart");
  assert.deepEqual(gate.measured.map(row=>row.label),["core","core"]);
  const state=readState(repo.layout.state);
  assert.equal(state.core.last_run?.verdict,"red","the completed red is preserved");
  assert.equal(state.core.last_run?.search,undefined,"no held search was fabricated");
  assert.equal(state.now?.doing,"restarting");
});

test("an in-flight core finishes normally when verified moves and the next run waits for restart",async t=>{
  const repo=repository(t),first=repo.commit({"a.txt":"1\n"},"first"),second=repo.commit({"a.txt":"2\n"},"second");
  repo.git.run(["branch","verified",first]);
  repo.git.run(["checkout","-q","--detach",first]);
  const gate=fakeGate(repo),fx=harness(repo,gate);
  fx.layout={...repo.layout,controller:repo.dir};
  fx.restartTarget=()=>controllerTarget(repo.git,fx.layout,repo.dir);
  const run=gate.run;
  gate.run=(...args)=>{repo.git.run(["update-ref","refs/heads/verified",second]);return run(...args);};
  assert.equal(await cycle(fx),"core");
  assert.equal(readState(repo.layout.state).core.last_run?.verdict,"green");
  assert.equal(await cycle(fx),"restart");
  assert.equal(gate.measured.length,1);
  assert.equal(readState(repo.layout.state).core.last_run?.verdict,"green");
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
  const script=resolutionSubject(observed,session,0)+generatedJavaScript(`import {mkdirSync,writeFileSync} from 'node:fs';
import {durableRecord as publishDelta} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};
mkdirSync('results',{recursive:true});writeFileSync('results/fresh.tsv','fresh row\\n');
publishDelta(process.argv[4]+'/${DELTA_FILE}',${JSON.stringify(delta)});\n`);
  const commit=repo.commit({'tooling/records/record-pending.ts':script,'LOG/tests':'pending: private-case is not recorded in results/fresh.tsv yet\n'},'new verified environment');
  let calls=0;
  const fx=harness(repo,fakeGate(repo),{recorder:(tree,pin,run,part)=>{
    calls++;
    assert.equal(repo.git.commit('verified'),commit,'verified moves before recording');
    assert.equal(tree,repo.layout.records.core,'the records unit records in the core\'s records tree');
    assert.equal(new Git(tree,repo.git.env).commit('HEAD'),commit,'recordAt uses that exact tree');
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

test("the hourly count removes what it found removable, stops what it found stoppable, then counts again", t => {
  const repo = repository(t);
  const left = { path: "/home/u/.cache/nts-messages/run-stopped", why: "left by tooling/messages.ts 2.0 days ago" };
  const slice = { unit: "ntscensusleftp2xbbbb.slice", why: "empty and bound to no active unit" };
  let counted = 0;
  const swept: string[][] = [], stopped: string[][] = [];
  const fx = counting(repo, {
    count: () => counted++ === 0
      ? { verdict: "FAIL", red: ["~/.cache/nts-messages: 1 folder(s) left"], notes: [], removable: [left], stoppable: [slice] }
      : { verdict: "PASS", red: [], notes: [], removable: [], stoppable: [] },
    sweep: removable => { swept.push(removable.map(one => one.path)); return [`swept ~/.cache/nts-messages/run-stopped: ${left.why}`]; },
    stopSlices: stoppable => { stopped.push(stoppable.map(one => one.unit)); return [`stopped ${slice.unit}: ${slice.why}`]; },
  });
  assert.equal(countOnce(fx).verdict, "PASS");
  assert.deepEqual(swept, [[left.path]]);
  assert.deepEqual(stopped, [[slice.unit]]);
  assert.ok(fx.lines.includes(`stopped ${slice.unit}: ${slice.why}`), fx.lines.join("\n"));
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
  const records = { ...state, core: { ...state.core, records: { commit: "r".repeat(40), at: "2026-11-09T09:30:00.000Z", submitted: "s".repeat(40), result: "landed as ssssssssssss", outcome: "landed" as const } },
    bench: { commit: "v".repeat(40), at: "2026-11-09T03:40:00.000Z", run: "/runs/bench", result: "run record x published on main mmmmmmmmmmmm (attempt 1): queued", submitted: "q".repeat(40), measured: true, outcome: "submitted" as const } };
  const typed = fullCheckStatus(records, inputs);
  assert.deepEqual([typed.core.records.last?.outcome, typed.benchmarks.last?.outcome], ["landed", "submitted"], "the status JSON carries each typed outcome");
  assert.match(statusText(typed), /^records: core 3 pending and 1 accepted listed; last rrrrrrrrrrrr landed: landed as ssssssssssss$/m);
  assert.match(statusText(typed), /^benchmarks: vvvvvvvvvvvv at 2026-11-09T03:40:00\.000Z: submitted: run record x published/m);
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
  const measuring = { ...state, benchmarks_due: { ...state.benchmarks_due, measuring: { commit: "v".repeat(40), at: "2026-11-09T03:40:00.000Z", run: "/runs/bench",
    job: { unit: "nts-full-check-bench", outcome: "/runs/bench/bench.outcome.json", at: "2026-11-09T03:40:00.000Z", starts: 1 } } } };
  assert.match(statusText(fullCheckStatus(measuring, inputs)), /^benchmarks: none; due until 2026-11-10T03:00:00\.000Z, measuring from 2026-11-09T03:40:00\.000Z in nts-full-check-bench$/m,
    "a run that measures says in which unit");
  // The count is the count's own file's, in the shape the cycle's count had.
  assert.deepEqual(s.count, count);
  assert.match(text, /^count: FAIL at 2026-11-09T10:00:03\.000Z, 1 line\(s\)\n {2}branch x \(on the machine\): named by no open issue/m);
  assert.equal(fullCheckStatus(state, { ...inputs, count: null }).count, null, "before the first count");
  assert.deepEqual(parseOptions(["--status", "--json"]).json, true);
  assert.throws(() => parseOptions(["--json"]), /--json is for --status/);
});

test('open task ids stay in status while their answers stay in state history',()=>{
  const state=readState('/nonexistent'),open=newTask(state,'2020-01-01T00:00:00.000Z','- an old open task');
  const done=newTask(state,'2026-11-13T00:00:00.000Z','- an answered task');done.answer={issue:592,at:'2026-11-13T01:00:00.000Z'};
  state.tasks=[open,done];
  const status=fullCheckStatus(state,{main:null,verified:null,unverified:null,landedAt:()=>'',controller:null,count:null,now:new Date('2026-11-13T02:00:00.000Z')});
  assert.deepEqual(status.tasks,[open]);
  assert.match(statusText(status),new RegExp(open.id+' 2020-01-01'));
  assert.ok(!statusText(status).includes(done.id));
  assert.equal(state.tasks.length,2);
});

test('an unanswered task survives more than fifty newer reports and another core task',async t=>{
  const repo=repository(t),state=readState(repo.layout.state),old=newTask(state,'2020-01-01T00:00:00.000Z','- the unanswered original');
  state.tasks.push(old);
  for(let index=0;index<75;index++)state.tasks.push(newTask(state,'2026-11-06T01:00:00.000Z',`- report ${index}`));
  writeState(repo.layout.state,state);
  repo.commit({'RED/tests':'red\n'},'a core with no green predecessor');
  await cycle(harness(repo,fakeGate(repo)));
  const current=readState(repo.layout.state);
  assert.ok(current.tasks.some(task=>task.id===old.id));
  assert.equal(current.tasks.length,77);
});

test('task acknowledgement arguments are complete and exclusive',()=>{
  const id='a'.repeat(16);
  assert.deepEqual(parseOptions(['--answer',id,'--issue','592']).answer,{id,answer:{issue:592}});
  assert.deepEqual(parseOptions([`--answer=${id}`,'--reason=fixed forward']).answer,{id,answer:{reason:'fixed forward'}});
  for(const args of [['--answer',id],['--issue','592'],['--answer',id,'--issue','0'],['--answer',id,'--reason',' '],['--answer',id,'--issue','592','--reason','both'],['--answer',id,'--issue','592','--status'],['--answer',id,'--answer',id,'--issue','592']])assert.throws(()=>parseOptions(args));
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
  const schedule = { nightly: "03:00" }, queue = stubQueue();
  const units = stubUnits(), morning = harness(repo, gate, { now: new Date(2026, 10, 6, 9, 0), schedule, recorder, queue, units });
  const first = repo.commit({
    "LOG/typescript-c": "  pending: tests/typescript/a.ts is not recorded in results/typescript/c/cases.tsv yet\n",
    "LOG/integrity": "  pending: tests/programs/b is not recorded in results/dex/outcomes.tsv yet\n",
  }, "each part lists a case of its own");
  assert.equal(await cycle(morning), "core");
  // The core's records unit still records when wide becomes eligible: each part owns its unit and tree.
  const later = harness(repo, gate, { now: new Date(2026, 10, 6, 10, 30), idle: true, schedule, recorder, queue, units });
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
  writeFileSync(repo.layout.state, JSON.stringify({ version: 1, core: {}, wide: { slot: "2026-11-09T10:00:00.000Z" }, culprits: [], probes: [], tasks: [],
    records: { commit: "c".repeat(40), at: "2026-11-09T11:38:29.560Z", submitted: null, result: "recorded nothing" },
    count: { at: "2026-11-09T10:51:58.846Z", verdict: "FAIL", lines: ["stale"] } }));
  const state = readState(repo.layout.state);
  assert.equal(state.core.records?.commit, "c".repeat(40));
  assert.equal((state as { records?: unknown }).records, undefined);
  assert.equal(state.wide.records, undefined);
  assert.equal((state.wide as { slot?: unknown }).slot, undefined, "obsolete slots cannot postpone verified-triggered work");
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

/** Real receipt validation around the existing deterministic gate fixture. */
function receiptGate(repo: Repository) {
  const gate = fakeGate(repo), original = gate.run.bind(gate), home = join(repo.root, "landing-verdicts");
  const calls: { commit: string; steps: string[]; label: string; reuse: boolean }[] = [];
  let observations = 0;
  const record = (commit: string, steps: string[]) => recordLandingFixture(home, commit,
    repo.git.run(["rev-parse", `${commit}^{tree}`]), steps);
  gate.run = (commit, steps, label, lastGreen, options) => {
    calls.push({ commit, steps: [...steps], label, reuse: options?.reuseLanding === true });
    const measure = (execute: readonly string[]) => {
      const result = original(commit, execute, label, lastGreen);
      writeFileSync(join(result.run, "summary.json"), JSON.stringify({
        identities: { commit }, environment: { canonical: true }, requested: execute,
        verdict: result.verdict, steps: execute.map(name => ({ name, verdict: result.steps[name], cpu: 1, wall: 1 })),
      }));
      return result;
    };
    if (!options?.reuseLanding) return measure(steps);
    return measureWithLanding({
      home, commit, requested: steps, contract: fixtureContract(), lastGreen,
      tree: repo.git.run(["rev-parse", `${commit}^{tree}`]),
      evidenceRun: join(repo.layout.runs, "evidence-" + ++observations), log: () => {}, measure,
    });
  };
  return { gate, record, calls };
}

test("the controller reuses exact landing passes in core and still executes the whole wide part", async t => {
  const repo = repository(t), first = repo.commit({ "a.txt": "first\n" }, "first");
  const f = receiptGate(repo);
  f.record(first, ["build", "tests", "integrity"]);
  const morning = harness(repo, f.gate, { now: new Date(2026, 10, 6, 9, 0) });
  assert.equal(await cycle(morning), "core");
  assert.deepEqual(f.gate.measured[0]!.steps, ["build", "typescript-c"]);
  assert.equal(verified(repo), first);
  const later = harness(repo, f.gate, { now: new Date(2026, 10, 6, 10, 30), idle: true });
  assert.equal(await cycle(later), "wide");
  assert.deepEqual(f.gate.measured.at(-1)!.steps, ["integrity"]);
  assert.equal(f.calls.at(-1)!.reuse, false);
});

test("a new controller without a matching checked-tip receipt executes the complete core", async t => {
  const repo = repository(t), first = repo.commit({ "a.txt": "first\n" }, "first"), f = receiptGate(repo);
  f.record(first, ["build", "tests"]);
  assert.equal(await cycle(harness(repo, f.gate)), "core");
  const next = repo.commit({ "a.txt": "next\n" }, "a different checked tree");
  assert.equal(await cycle(harness(repo, f.gate)), "core");
  assert.equal(f.gate.measured.at(-1)!.commit, next);
  assert.deepEqual(f.gate.measured.at(-1)!.steps, ["build", "tests", "typescript-c"]);
  assert.equal(verified(repo), next);
});

test("culprit search consumes reused passes as the measured commit's observation and confirms failures freshly", async t => {
  const repo = repository(t), good = repo.commit({ "src.txt": "base\n" }, "good"), f = receiptGate(repo);
  f.record(good, ["build", "tests", "typescript-c"]);
  const fx = harness(repo, f.gate);
  await cycle(fx);
  const { a, b, c, d } = redHistory(repo);
  f.record(a, ["build", "tests", "typescript-c"]);
  for (const commit of [b, c, d]) f.record(commit, ["build", "tests"]);
  await cycle(fx);
  const state = readState(repo.layout.state);
  assert.deepEqual(state.culprits.map(finding => finding.commit), [b]);
  assert.equal(verified(repo), good);
  assert.ok(f.calls.some(call => call.label === "core-probe" && call.commit === a && call.reuse));
  assert.equal(f.gate.measured.some(call => call.label === "core-probe" && call.commit === a), false);
  assert.ok(f.calls.some(call => call.label === "core-probe" && call.commit === d && !call.reuse));
  assert.ok(f.calls.some(call => call.label === "core-probe" && call.commit === good && !call.reuse));
  assert.ok(f.calls.some(call => call.label === "core-probe" && call.commit === b && !call.reuse));
  assert.equal(state.probes.some(probe => probe.key.includes(a) && probe.step === "typescript-c"), false);
  const e = repo.commit({ "e.txt": "e\n" }, "while the revert waits");
  f.record(e, ["build", "tests"]);
  await cycle(harness(repo, f.gate));
  assert.equal(readState(repo.layout.state).culprits.length, 1);
  assert.ok(f.calls.some(call => call.label === "core-probe" &&
    repo.git.subject(call.commit).startsWith("full check: ") && call.commit !== e));
});


test('controller cycle and error naps drain on a named unit stop',async t=>{
  const root=testScratch(t,'full-check-stop-nap');
  for(const milliseconds of [60_000,5*60_000]){
    const file=join(root,String(milliseconds)+'.mjs'),ready=join(root,String(milliseconds)+'.ready');
    writeFileSync(file,generatedJavaScript(`import {writeFileSync} from 'node:fs';
import {waitForControllerCycle} from ${JSON.stringify(new URL('./service.ts',import.meta.url).href)};
import {runAsCommand,registerCommandCloser} from ${JSON.stringify(new URL('../differential/command-entry/main.ts',import.meta.url).href)};
runAsCommand(import.meta.url,async()=>{
  registerCommandCloser('controller test receipt',{close:()=>writeFileSync(${JSON.stringify(ready)}+'.closed','closed')});
  const waiting=waitForControllerCycle(${milliseconds});
  writeFileSync(${JSON.stringify(ready)},'armed');
  await waiting;writeFileSync(${JSON.stringify(ready)}+'.continued','another cycle');
});`));
    const unit='nts-test-controller-nap-'+randomUUID();
    let output='',ended=false;
    const child=spawn('systemd-run',['--user','--wait','--pipe','--collect','--unit='+unit,
      '-p','KillMode=control-group','-p','TimeoutStopSec=120s','-p','LimitCORE=0','-p','Nice=19',
      '--','taskset','-c','0-3,6-31',process.execPath,file],{env:hostEnvironment(process.env),stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
    const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{ended=true;resolve(code);});});
    try{
      await waitFor('the controller nap to be armed',()=>existsSync(ready),{stopped:()=>ended?output:undefined});
      const stopped=spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});assert.equal(stopped.status,0,stopped.stderr);
      assert.equal(await closed,143,output);
      assert.equal(readFileSync(ready+'.closed','utf8'),'closed');
      assert.equal(existsSync(ready+'.continued'),false,'shutdown cannot start another cycle');
      assert.doesNotMatch(output,/wedged drain|timed out|Killing/);
    }finally{
      spawnTest('systemctl',['--user','stop',unit],{encoding:'utf8'});await closed;
    }
  }
});
