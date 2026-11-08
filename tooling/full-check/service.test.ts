// node --test tooling/full-check/service.test.ts
//
// The loop over a scratch repository with a local bare origin and a stand-in
// gate (repository-fixture.ts): it takes the newest main, moves and pushes
// verified on a green core only, reverts the first red commit and submits the
// revert first, and records after a green run that listed pending cases.
import assert from "node:assert/strict";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {assertMessage, ENV, fakeGate, repository, stubBench, stubQueue, type FakeGate, type Repository} from "./repository-fixture.ts";
import type { Recorder } from "./records.ts";
import {cycle, followVerified, parseOptions, partSteps, RECORDER_LOG, recordPending, type Effects} from "./service.ts";
import {readState} from "./state.ts";
import {Git} from "./git.ts";

type Harness = Effects & { lines: string[]; queue: Effects["queue"]; submitted: ReturnType<typeof stubQueue>["submitted"]; withdrawn: string[] };

function harness(repo: Repository, gate: FakeGate, options: { now?: Date; recorder?: Recorder; schedule?: Effects["schedule"]; bench?: Effects["bench"]; prunePool?: Effects["prunePool"] } = {}): Harness {
  const lines: string[] = [];
  const queue = stubQueue();
  return {
    layout: repo.layout,
    git: repo.git,
    gate,
    queue,
    submitted: queue.submitted,
    withdrawn: queue.withdrawn,
    recorder: options.recorder ?? (() => ({ status: 0, output: "" })),
    bench: options.bench ?? stubBench(),
    pins: join(repo.root, "pins"),
    count: () => ({ verdict: "PASS", red: [], notes: [], removable: [] }),
    sweep: () => [],
    prunePool: options.prunePool ?? (() => []),
    pruneNodeCache: () => ({root:"private fixture",state:"missing",removed:0,removedBytes:0,kept:0,keptBytes:0,changed:0,skipped:0,errors:[]}),
    push: commit => {
      const r = repo.git.try(["push", "-q", "origin", `${commit}:refs/heads/verified`]);
      return { ok: r.status === 0, line: r.status === 0 ? `pushed ${commit}` : r.stderr };
    },
    admit: () => {},
    now: () => options.now ?? new Date(2026, 10, 6, 12, 0),
    log: line => lines.push(line),
    schedule: options.schedule ?? { wide: ["10:00"], nightly: "03:00" },
    lines,
  };
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

  // Nothing new on main: no run, only the hourly count.
  assert.equal(await cycle(fx), "count");
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
  assert.ok(fx.lines.some(line => line.startsWith("TASK for docs/plan.md: - Land ") && line.includes(b.slice(0, 12)) && line.includes("typescript-c")), fx.lines.join("\n"));
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
  assert.equal(await cycle(fx), "count", "not yet");
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

test("a green run that listed pending cases records them, commits exactly the records and submits the commit", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const recorder: Recorder = (tree, pin, run) => {
    assert.ok(existsSync(pin), "the recorder runs with the run's pin");
    mkdirSync(join(tree, "results/oracle-counts/tests/programs"), { recursive: true });
    writeFileSync(join(tree, "results/oracle-counts/tests/programs/new-case.json"), "{\"cases\": 3}\n");
    writeFileSync(join(tree, "scratch-output.txt"), "not a record\n");
    writeFileSync(join(run, RECORDER_LOG), "record-pending: 1 row(s) recorded\n");
    return { status: 0, output: "" };
  };
  const fx = harness(repo, gate, { recorder });
  const commit = repo.commit({ "LOG/typescript-c": "  pending: tests/programs/new-case is not recorded in results/oracle-counts/tests/programs/new-case.json yet\n" }, "a new case");
  await cycle(fx);
  const state = readState(repo.layout.state);
  assert.equal(state.core.last_green?.commit, commit);
  assert.equal(state.records?.commit, commit);
  const records = state.records!.submitted!;
  assert.ok(records, state.records?.result);
  assert.deepEqual(fx.submitted, [{ commit: records, first: false }]);
  assert.equal(repo.git.run(["rev-parse", `${records}^`]), commit);
  assert.deepEqual(repo.git.run(["diff", "--name-only", commit, records]).split("\n"), ["results/oracle-counts/tests/programs/new-case.json"], "only what the recorder wrote under the records");
  assertMessage(repo.git, records, /^records: the pending and improved rows at /, /1 pending/);
  assert.ok(fx.lines.some(line => line.includes("TASK") && line.includes("scratch-output.txt")), "what it wrote elsewhere is named");
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

test("the nightly slot runs the wide steps, then nts-bench on verified, and submits its results-only commit", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const bench = stubBench({ slower: ["awfy-list", "richards"] });
  const day = harness(repo, gate, { now: new Date(2026, 10, 6, 23, 0), bench });
  const first = repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(day); // the 22:00 slot finds nothing verified; the core verifies main
  assert.equal(verified(repo), first);
  const night = harness(repo, gate, { now: new Date(2026, 10, 7, 3, 30), bench });
  assert.equal(await cycle(night), "wide");
  const labels = gate.measured.map(m => `${m.label} ${m.steps.join(" ")}`);
  assert.deepEqual(labels.slice(-2), ["wide integrity", "bench-build build"], "nts-bench is built from the commit it measures");
  assert.equal(bench.calls.length, 1);
  const state = readState(repo.layout.state);
  assert.equal(state.bench?.commit, first);
  assert.equal(state.bench?.measured, true);
  const results = state.bench!.submitted!;
  assert.ok(results, state.bench?.result);
  assert.deepEqual(night.submitted, [{ commit: results, first: false }]);
  assert.equal(repo.git.run(["rev-parse", `${results}^`]), first);
  assert.equal(repo.git.commit(`refs/full-check/benchmarks/${first.slice(0, 12)}`), results);
  assert.ok(night.lines.some(line => line.includes("TASK") && line.includes("2 benchmark row(s) slower than their own best") && line.includes("awfy-list, richards")), night.lines.join("\n"));

  // The next night, verified unchanged: no second run of the same commit.
  const next = harness(repo, gate, { now: new Date(2026, 10, 8, 3, 30), bench });
  await cycle(next);
  assert.equal(bench.calls.length, 1);
  assert.ok(next.lines.some(line => line.includes("already measured")));
});

test("a machine that is never quiet gives the night up, and the next nightly slot tries again", async t => {
  const repo = repository(t);
  const gate = fakeGate(repo);
  const busy = stubBench({ quiet: false });
  repo.commit({ "a.txt": "1\n" }, "verified one");
  await cycle(harness(repo, gate, { now: new Date(2026, 10, 6, 23, 0) }));
  const night = harness(repo, gate, { now: new Date(2026, 10, 7, 3, 30), bench: busy });
  await cycle(night);
  assert.equal(readState(repo.layout.state).bench?.measured, false);
  assert.equal(night.submitted.length, 0);
  const quiet = stubBench();
  const next = harness(repo, gate, { now: new Date(2026, 10, 8, 3, 30), bench: quiet });
  assert.equal(await cycle(next), "benchmarks", "the wide steps ran last night on this commit; the benchmarks did not");
  assert.equal(quiet.calls.length, 1);
  assert.equal(readState(repo.layout.state).bench?.measured, true);
});

test("the hourly count runs the pool's upkeep first, and a failed upkeep is a line, not a stopped cycle", async t => {
  const repo = repository(t);
  repo.commit({ "a.txt": "1\n" }, "one");
  let upkeeps = 0, fail = false;
  const fx = harness(repo, fakeGate(repo), { prunePool: () => { upkeeps++; if (fail) throw new Error("the pool's lock is held"); return ["pool: removed tree 3, free and idle 4d 2h"]; } });
  assert.equal(await cycle(fx), "core");
  assert.equal(upkeeps, 0, "a run comes first");
  assert.equal(await cycle(fx), "count");
  assert.equal(upkeeps, 1);
  assert.ok(fx.lines.includes("pool: removed tree 3, free and idle 4d 2h"), fx.lines.join("\n"));
  assert.equal(await cycle(fx), "idle", "once an hour, with the count");
  assert.equal(upkeeps, 1);
  fail = true;
  const hourLater = new Date(2026, 10, 6, 13, 1);
  const later = harness(repo, fakeGate(repo), { now: hourLater, prunePool: fx.prunePool });
  assert.equal(await cycle(later), "count");
  assert.ok(later.lines.includes("pool: upkeep failed: the pool's lock is held"), later.lines.join("\n"));
  assert.equal(readState(repo.layout.state).count?.at, hourLater.toISOString(), "and the count still ran");
});

test("the parts' steps come from the measured commit's lists", () => {
  const lists = { all: ["build", "tests", "integrity", "profile"], wide: ["integrity", "profile", "gone"] };
  assert.deepEqual(partSteps("core", lists), ["build", "tests"]);
  assert.deepEqual(partSteps("wide", lists), ["integrity", "profile"]);
});

test("the command line sets the schedule", () => {
  assert.deepEqual(parseOptions(["--wide-at=16:00,10:00", "--nightly-at=02:30"]).schedule, { wide: ["10:00", "16:00"], nightly: "02:30" });
  assert.equal(parseOptions(["--bench-wait=90"]).quietWait, 90);
  assert.equal(parseOptions([]).quietWait, 240);
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


test("cache upkeep runs only on the hourly count and warnings never change its verdict", async t => {
  const repo = repository(t), fx = harness(repo, fakeGate(repo));
  repo.commit({"a.txt":"one"}, "one");
  await cycle(fx); // Verify main first; upkeep is separate from a measured run.
  let now = new Date(2026, 10, 6, 12), calls = 0;
  fx.now = () => now;
  fx.pruneNodeCache = () => {
    calls++;
    return {root:"private fixture",state:"warning",removed:2,removedBytes:17,kept:1,keptBytes:9,changed:0,skipped:0,errors:["private cache control"]};
  };
  assert.equal(await cycle(fx), "count");
  assert.equal(calls, 1);
  assert.equal(readState(repo.layout.state).count?.verdict, "PASS");
  assert.ok(fx.lines.some(line => line.includes("removed 2 entries / 17 bytes")));
  assert.ok(fx.lines.some(line => line.includes("private cache control")));
  assert.equal(await cycle(fx), "idle");
  assert.equal(calls, 1);
  now = new Date(2026, 10, 6, 13);
  fx.pruneNodeCache = () => { calls++; throw new Error("unreadable private cache"); };
  assert.equal(await cycle(fx), "count");
  assert.equal(calls, 2);
  assert.equal(readState(repo.layout.state).count?.verdict, "PASS");
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
  // The fake recorder reports what the oracles it would run are given.
  writeFileSync(join(tree, "tooling/records/record-pending.ts"), `import {existsSync} from "node:fs";
console.log(JSON.stringify({ canonical: !!process.env.NTS_GATE_ENV_CONTEXT, tmp: process.env.TMPDIR, there: existsSync(process.env.TMPDIR ?? ""), bin: process.env.NTS_BIN }));
`);
  const result = recordPending(tree, "pin", run);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(readFileSync(join(run, RECORDER_LOG), "utf8")), { canonical: true, tmp: join(run, "records", "tmp"), there: true, bin: "pin" });
  assert.equal(existsSync(join(run, "records", "tmp")), false, "its temporary folder goes after it");
});

test("the recorder's output reaches the run's log while it runs, so no buffer bounds it", t => {
  const repo = repository(t), tree = join(repo.root, "tree"), run = join(repo.root, "run"), log = join(run, RECORDER_LOG);
  mkdirSync(join(tree, "tooling/records"), { recursive: true });
  mkdirSync(run);
  // The core run's own `records` step logs beside it; the recorder leaves that log alone.
  writeFileSync(join(run, "records.log"), "the records step's log\n");
  // The fake recorder looks for its own first line in the log before it exits.
  writeFileSync(join(tree, "tooling/records/record-pending.ts"), `import {existsSync, readFileSync} from "node:fs";
process.stdout.write("first line\\n");
const seen = existsSync(${JSON.stringify(log)}) && readFileSync(${JSON.stringify(log)}, "utf8").includes("first line");
process.stdout.write(seen ? "streamed\\n" : "buffered\\n");
process.exit(seen ? 3 : 4);
`);
  const result = recordPending(tree, "pin", run);
  assert.equal(result.status, 3, readFileSync(log, "utf8"));
  assert.equal(readFileSync(log, "utf8"), "first line\nstreamed\n");
  assert.equal(result.output, "first line\nstreamed\n", "the result carries the log's tail");
  assert.equal(readFileSync(join(run, "records.log"), "utf8"), "the records step's log\n");
});

test("the hourly count removes what it found removable, then counts again", async t => {
  const repo = repository(t), fx = harness(repo, fakeGate(repo));
  repo.commit({"a.txt":"one"}, "one");
  await cycle(fx);
  const left = { path: "/home/u/.cache/nts-messages/run-stopped", why: "left by tooling/messages.ts 2.0 days ago" };
  let counted = 0;
  const swept: string[][] = [];
  fx.count = () => counted++ === 0
    ? { verdict: "FAIL", red: ["~/.cache/nts-messages: 1 folder(s) left"], notes: [], removable: [left] }
    : { verdict: "PASS", red: [], notes: [], removable: [] };
  fx.sweep = removable => { swept.push(removable.map(one => one.path)); return [`swept ~/.cache/nts-messages/run-stopped: ${left.why}`]; };
  assert.equal(await cycle(fx), "count");
  assert.deepEqual(swept, [[left.path]]);
  assert.equal(counted, 2, "what is left is counted after the sweep");
  assert.equal(readState(repo.layout.state).count?.verdict, "PASS");
  assert.ok(fx.lines.includes(`swept ~/.cache/nts-messages/run-stopped: ${left.why}`), fx.lines.join("\n"));
});
