// node --test tooling/full-check/bench.test.ts
//
// How the benchmarks unit asks for a run -- the session's memory, then the
// measurement lock, from its own tree -- and what it keeps of one: the record
// in nts-bench's results-only commit on verified, nothing else; and how that
// record is published on main, by main's own run-record.ts, as a results-only
// commit there.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { look, newJob, readOutcome } from "./background.ts";
import { admission, FULL_MD, measureJob, publishAt, publishRecord, resultsCommit, RUNS, slowerRows, type MeasureJob, type MeasureOutcome } from "./bench.ts";
import { Git } from "./git.ts";
import { checkoutIn, ENV, publishEveryRun, repository, stubBench } from "./repository-fixture.ts";
import { candidateEnvironmentFixture } from "./run-environment-fixture.ts";
import { hostEnvironment } from "../gate/canonical-environment.ts";
import { readLedger } from "../gate/memory-ledger.ts";
import { gateEnvironment } from "../gate/canonical-environment.ts";
import { ownMemory } from "../gate/test-memory.ts";
import { toolingSliceArgs } from "../gate/tooling-slice.ts";
import { COLUMNS, COMPARATORS, POLICY } from "../bench/run-record.ts";
import { removable } from "../gate/run-temporary.ts";

function scratch(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => { removable(dir); rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function inUnit(t: TestContext, root: string, body: (unit: string) => string) {
  const unit = `nts-test-bench-session-${randomUUID()}`, script = join(root, "unit.ts");
  writeFileSync(script, body(unit));
  const memory = ownMemory(join(root, "own-memory"));
  const env = gateEnvironment(hostEnvironment(process.env), { run: join(root, "canonical"), standalone: true, owned: memory }).env;
  const setenv = Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([key, value]) => `--setenv=${key}=${value}`);
  t.after(() => { spawnSync("systemctl", ["--user", "stop", unit], { stdio: "ignore" }); });
  const ran = spawnSync("systemd-run", ["--user", ...toolingSliceArgs(), `--unit=${unit}`, "--collect", "--wait", "--pipe", "--quiet",
    "--property=RuntimeMaxSec=300s", "--property=LimitCORE=0", "--property=Nice=19", "--property=CPUAffinity=0-3 6-31",
    ...setenv, process.execPath, script], { encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  return memory;
}

test("the results-only commit on its base is the run's; anything else is named", t => {
  const repo = repository(t), run = scratch(t, "full-check-bench-");
  const verified = repo.commit({ "a.txt": "1\n" }, "verified");
  assert.deepEqual(resultsCommit(repo.git, verified), { none: "nts-bench committed no run record" });
  stubBench()(repo.dir, run);
  assert.deepEqual(resultsCommit(repo.git, verified), { commit: repo.git.run(["rev-parse", "HEAD"]) });

  const other = repo.commit({ "b.txt": "2\n" }, "an ordinary commit");
  assert.deepEqual(resultsCommit(repo.git, verified), { none: `the tree's HEAD ${other.slice(0, 12)} is not a results commit on ${verified.slice(0, 12)}` });
  stubBench({ stray: true })(repo.dir, run);
  assert.deepEqual(resultsCommit(repo.git, other), { none: "the results commit also changes stray.txt" });
});

test("rows full.md marks slower than their own best are read by case", () => {
  const page = ["# Benchmark results", "| Case | nts C | nts C own best |", "|---|---|---|",
    "|awfy-list|9.68 µs|9.00 µs; abc; [run](runs/x.json) **SLOWER THAN BEST**|", "|arrays|1.39 µs|1.39 µs|",
    "Prose that mentions **SLOWER THAN BEST** is not a row."].join("\n");
  assert.deepEqual(slowerRows(page), ["awfy-list"]);
});

test("the session reserves first, by the history it is given, then the tree's own with-lock.sh admits nts-bench, without --wait; exit 75 is a run that did not start", t => {
  const root = scratch(t, "full-check-lock-");
  const gate = join(root, "tree/tooling/gate"), tree = join(root, "tree"), run = join(root, "run"), history = join(root, "target/gate-costs");
  for (const dir of [gate, run]) mkdirSync(dir, { recursive: true });
  // The session reserves in a ledger of the test's own, against a reading of its own.
  // A stand-in with-lock.sh in the measured tree: it says what it was asked to
  // run, inside which reservation and by which history, and admits it or
  // refuses it as the test says.
  writeFileSync(join(gate, "with-lock.sh"), [
    'printf "%s\\n" "$@" > "$(dirname "$0")/argv"',
    'printf "%s\\n" "$NTS_MEMORY_PRIORITY" "${NTS_MEMORY_RESERVATION:+a reservation}" "$NTS_GATE_COSTS_DIR" > "$(dirname "$0")/memory"',
    'printf "%s\\n" "${SYSTEMD_EXEC_PID-}" "${INVOCATION_ID-}" "${MANAGERPID-}" "$TMPDIR" > "$(dirname "$0")/identity"',
    'if [ -e "$(dirname "$0")/refuse" ]; then echo "with-lock: pid 4242 is measuring; not starting another" >&2; exit 75; fi',
    'echo "nts-bench measured"',
    "",
  ].join("\n"));
  const memory = inUnit(t, root, unit => `import {benchWithLock} from ${JSON.stringify(import.meta.url.replace(/bench.test.ts$/, "bench.ts"))};
import {writeFileSync} from 'node:fs';
process.env.SYSTEMD_EXEC_PID = process.env.INVOCATION_ID = process.env.MANAGERPID = 'parent-unit-marker';
const bench = benchWithLock(${JSON.stringify(join(run, "nts-bench"))}, ${JSON.stringify(history)}, ${JSON.stringify(unit)});
writeFileSync(${JSON.stringify(join(run, "first.json"))}, JSON.stringify(bench(${JSON.stringify(tree)}, ${JSON.stringify(run)})));
writeFileSync(${JSON.stringify(join(gate, "refuse"))}, '');
writeFileSync(${JSON.stringify(join(run, "second.json"))}, JSON.stringify(bench(${JSON.stringify(tree)}, ${JSON.stringify(run)})));
`);
  assert.deepEqual(JSON.parse(readFileSync(join(run, "first.json"), "utf8")), { admitted: true, status: 0 });
  const argv = readFileSync(join(gate, "argv"), "utf8").split("\n").filter(Boolean);
  assert.deepEqual(argv.slice(0, 4), [join(run, "nts-bench"), "--root", tree, "--journal"]);
  assert.ok(argv[4].startsWith(run + "/bench-"));
  assert.deepEqual(readFileSync(join(gate, "memory"), "utf8").split("\n").filter(Boolean), ["full-check", "a reservation", history],
    "the session holds its memory before the lock admits it, at the full check's priority, sized by the history it is given");
  assert.equal(readLedger(memory.NTS_MEMORY_LEDGER).admitted.filter(entry => entry.live).length, 0, "the session's reservation ends with it");
  const identity = readFileSync(join(gate, "identity"), "utf8").split("\n");
  assert.deepEqual(identity.slice(0, 3), ["", "", ""], "a canonical command never receives another unit's systemd metadata");
  assert.ok(identity[3].startsWith(root), "the command owns temporary storage under the run");
  assert.deepEqual(JSON.parse(readFileSync(join(run, "second.json"), "utf8")), { admitted: false, reason: "with-lock: pid 4242 is measuring; not starting another" });
  // Between the two, what the ledger says of the first session's reservation, which ended with it.
  assert.match(readFileSync(join(run, "bench.log"), "utf8"), /nts-bench measured[\s\S]*with-lock: pid 4242 is measuring/);
});

test("why a run was not admitted is the last refusal its log gives, the lock's or nts-bench's", () => {
  const waiting = "with-lock: waiting for CPUs 4-5 to run no other program and stay at least 90% idle on average for 45 s (limit 180 s)";
  assert.equal(admission(`${waiting}\nwith-lock: CPUs 4-5 did not become quiet; releasing the measurement lock without starting a run\n`),
    "with-lock: CPUs 4-5 did not become quiet; releasing the measurement lock without starting a run");
  assert.equal(admission(`${waiting}\nnot admitted: another program ran on CPU 5, its sibling, before this run started\n`),
    "not admitted: another program ran on CPU 5, its sibling, before this run started");
  assert.equal(admission(""), "exit 75, and the log says no more");
});

for (const stopFails of [false, true]) test(`a session past its budget retains its prefix and never restarts, including stop failure: ${stopFails}`, t => {
  const repo = repository(t), run = scratch(t, "full-check-budget-");
  repo.git.run(["config", "user.name", "benchmark-test"]);
  repo.git.run(["config", "user.email", "benchmark@example.invalid"]);
  const commit = repo.commit({ "a.txt": "measured source\n" }, "verified");
  const cases = ["control", "not-reached"];
  for (const name of cases) mkdirSync(join(repo.dir, "benchmarks/cases", name), { recursive: true });
  const journal = join(run, "prepared.jsonl"), outcome = join(run, "outcome.json"), history = join(run, "history");
  const metadata = { schemaVersion: 1, id: "2026-11-10-" + commit.slice(0, 12) + "-budget", startedAt: null, finishedAt: null,
    complete: false, inventory: cases, columns: [...COLUMNS], sourceCommit: commit, compiler: { commit, sha256: "b".repeat(64) },
    harness: { identity: "b".repeat(64), contract: null, files: [] }, machine: { identity: null, conditions: {} },
    comparators: Object.fromEntries(COMPARATORS.map(c => [c, null])), verdictPolicy: POLICY, provenance: {} };
  const measurement = { ns_per_op: 100, checksum: "4000000000000000", spread: 1 };
  const observed = { shown: "control", workload: null, source_capture: null,
    results: [measurement, measurement, null, measurement, measurement, null],
    absences: { outcomes: {}, jvm: null, cpp: null }, node: measurement, bun: measurement };
  // A durable row already belongs to this run. The active case never returns;
  // the real budget must stop its entire unit before publishing this prefix.
  writeFileSync(journal, JSON.stringify({ version: 1, metadata, cases, requested: [], lanes: null }) + "\n" +
    JSON.stringify({ name: "control", measured: observed, failure: null, conditions: {}, spoiled: false, failed: [] }) + "\n" + '{"name":"not-reached"');
  const gate = join(repo.dir, "tooling/gate"); mkdirSync(gate, { recursive: true });
  writeFileSync(join(gate, "with-lock.sh"), 'exec "$@"\n');
  const binary = join(run, "blocked-bench");
  const marker = join(run, "stop-refused"), bin = join(run, "bin");
  if (stopFails) {
    mkdirSync(bin);
    writeFileSync(join(bin, "systemctl"), `#!${process.execPath}
import {writeFileSync} from 'node:fs'; import {spawnSync} from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === '--user' && args[1] === 'stop' && args[2].startsWith('nts-bench-session-')) {
  writeFileSync(${JSON.stringify(marker)}, 'the stop failed'); console.error('deliberate stop failure'); process.exit(1);
}
process.exit(spawnSync('/usr/bin/systemctl', args, {stdio:'inherit'}).status ?? 1);
`, { mode: 0o755 });
    writeFileSync(binary, `#!${process.execPath}
import {watch, existsSync} from 'node:fs';
await new Promise(resolve => {
  const observer = watch(${JSON.stringify(run)}, () => { if (existsSync(${JSON.stringify(marker)})) { observer.close(); resolve(); } });
  if (existsSync(${JSON.stringify(marker)})) { observer.close(); resolve(); }
});
`, { mode: 0o755 });
  } else {
    writeFileSync(binary, `#!/bin/sh\nexec node -e 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)'\n`, { mode: 0o755 });
  }
  const sessionModule = new URL("./bench-session.ts", import.meta.url).href;
  const memory = inUnit(t, run, unit => `import {runSession} from ${JSON.stringify(sessionModule)};
import {measureJob} from ${JSON.stringify(new URL("./bench.ts", import.meta.url).href)};
${stopFails ? `process.env.PATH = ${JSON.stringify(bin)} + ':' + process.env.PATH;` : ""}
const attempt = await runSession(${JSON.stringify(repo.dir)}, ${JSON.stringify(run)}, ${JSON.stringify(binary)}, ${JSON.stringify(history)}, ${JSON.stringify(unit)}, 500, ${JSON.stringify(journal)});
measureJob(${JSON.stringify(repo.dir)}, ${JSON.stringify({ commit, run, bench: binary, history, outcome })}, () => attempt);
`);
  const saved = readOutcome<MeasureOutcome>(outcome)!;
  assert.deepEqual(saved.budget, { milliseconds: 500, unreached: ["not-reached"] });
  assert.equal(saved.status, 124);
  assert.equal(existsSync(marker), stopFails, "the control actually refused its stop before the child completed");
  assert.ok(saved.record, JSON.stringify(saved));
  const record = JSON.parse(readFileSync(saved.record!, "utf8"));
  assert.equal(record.complete, false);
  assert.equal(record.rows[0].cells.node.nanoseconds, 100);
  assert.equal(record.rows[1].cells.node.status, "NOT_RUN");
  assert.match(record.rows[1].cells.node.reason, /time budget/);
  assert.deepEqual(record.provenance.session.unreached, ["not-reached"]);
  assert.equal(readLedger(memory.NTS_MEMORY_LEDGER).admitted.filter(entry => entry.live).length, 0);
  const job = newJob("owned-benchmark-test", outcome, new Date("2026-11-10T00:00:00Z"));
  const units = { running: () => false, start: () => { throw new Error("a completed budget must never restart"); } };
  assert.equal(look(job, units, new Date("2026-11-10T00:00:01Z")).state, "ended");
  assert.equal(look(job, units, new Date("2026-11-10T00:00:02Z")).state, "ended");
  assert.equal(job.starts, 1);
});

test("the unit's work keeps the run's record, as nts-bench committed it, in its run's folder, and writes its outcome last; or says why there is none", t => {
  const repo = repository(t), run = scratch(t, "full-check-measure-");
  const verified = repo.commit({ "a.txt": "1\n" }, "verified");
  const job = (outcome: string): MeasureJob => ({ commit: verified, run, bench: join(run, "nts-bench"), history: join(run, "costs"), outcome: join(run, outcome) });
  const outcome = (name: string) => { const { at: _at, ...rest } = readOutcome<MeasureOutcome>(join(run, name))!; return rest; };
  measureJob(repo.dir, job("refused.json"), () => ({ admitted: false, reason: "with-lock: pid 4242 is measuring; not starting another" }));
  assert.deepEqual(outcome("refused.json"), { version: 1, status: 75, admitted: false, reason: "with-lock: pid 4242 is measuring; not starting another" });
  measureJob(repo.dir, job("none.json"), () => ({ admitted: true, status: 1 }));
  assert.deepEqual(outcome("none.json"), { version: 1, status: 1, admitted: true, none: "nts-bench committed no run record" });
  const bench = stubBench();
  measureJob(repo.dir, job("kept.json"), (tree, at) => {
    assert.equal(existsSync(join(run, "kept.json")), false, "the outcome is the work's last act");
    return bench(tree, at);
  });
  const kept = outcome("kept.json"), committed = repo.git.run(["diff", "--name-only", verified, "HEAD", "--", RUNS]);
  assert.deepEqual(kept, { version: 1, status: 0, admitted: true, record: join(run, committed.slice(RUNS.length + 1)) });
  assert.equal(readFileSync(kept.record!, "utf8"), repo.git.output(["show", `HEAD:${committed}`]));
});

test("a record is published on main as a results-only commit there; once main has it, there is nothing to publish; anything else fails", t => {
  const repo = repository(t), run = scratch(t, "full-check-publish-");
  const main = repo.commit({ "a.txt": "1\n" }, "main");
  const tree = join(repo.root, "bench"), git = new Git(tree, ENV), checkout = checkoutIn(repo, tree);
  const record = join(run, "2026-11-09-run.json"), log = join(run, "publish.log");
  writeFileSync(record, `${JSON.stringify({ slower: ["awfy-list"] })}\n`);
  const published = publishAt(git, main, checkout, at => publishEveryRun(at, record, log));
  assert.equal(published.kind, "committed", JSON.stringify(published));
  if (published.kind !== "committed") return;
  assert.equal(repo.git.run(["rev-parse", `${published.commit}^`]), main);
  assert.deepEqual(repo.git.run(["diff", "--name-only", main, published.commit]).split("\n"), [FULL_MD, `${RUNS}/2026-11-09-run.json`]);
  assert.deepEqual(slowerRows(repo.git.run(["show", `${published.commit}:${FULL_MD}`])), ["awfy-list"], "the page main's renderer made");
  // Landed: main has the record and its page, and publishing it again commits nothing.
  repo.git.run(["merge", "-q", "--ff-only", published.commit]);
  assert.deepEqual(publishAt(git, published.commit, checkout, at => publishEveryRun(at, record, log)), { kind: "none" });
  assert.deepEqual(publishAt(git, published.commit, checkout, () => ({ status: 1, output: "schema: no such column" })), { kind: "failed", why: "exited 1" });
  const stray = publishAt(git, published.commit, checkout, at => {
    writeFileSync(join(at, "stray.txt"), "x\n");
    new Git(at, ENV).run(["add", "stray.txt"]);
    new Git(at, ENV).run(["commit", "-q", "-m", "results: retain benchmark run x"]);
    return { status: 0, output: "" };
  });
  assert.deepEqual(stray, { kind: "failed", why: "the results commit also changes stray.txt" });
});

test("main's own run-record.ts publishes in the gate's canonical environment, with main's Node, in a temporary folder of its own", t => {
  const repo = repository(t), tree = join(repo.root, "tree"), run = join(repo.root, "run");
  mkdirSync(join(tree, "tooling/bench"), { recursive: true });
  mkdirSync(run);
  candidateEnvironmentFixture(tree);
  // The fake publisher reports what it was given, then ends as the real one does, with the record's path.
  writeFileSync(join(tree, "tooling/bench/run-record.ts"), `import {existsSync} from "node:fs";
console.log(JSON.stringify({ canonical: !!process.env.NTS_GATE_ENV_CONTEXT, tmp: process.env.TMPDIR, there: existsSync(process.env.TMPDIR ?? ""), argv: process.argv.slice(2) }));
console.log(process.argv[3] + "/results/benchmarks/runs/x.json");
`);
  const record = join(run, "x.json"), log = join(run, "publish-1.log");
  const result = publishRecord(tree, record, log, { env: { ...hostEnvironment(process.env), HOME: repo.root } });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(result.output.split("\n")[0]!), { canonical: true, tmp: join(run, "publish", "tmp"), there: true, argv: ["publish", tree, record, "commit"] });
  assert.equal(readFileSync(log, "utf8"), result.output, "its output is its log");
  assert.equal(existsSync(join(run, "publish", "tmp")), false, "its temporary folder goes after it");
  assert.deepEqual(publishRecord(join(repo.root, "nowhere"), record, log), { status: 2, output: "no tooling/bench/run-record.ts at main" });
});
