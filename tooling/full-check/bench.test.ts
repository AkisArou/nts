// node --test tooling/full-check/bench.test.ts
//
// How the benchmarks unit asks for a run -- the session's memory, then the
// measurement lock, from its own tree -- and what it keeps of one: the record
// in nts-bench's results-only commit on verified, nothing else; and how that
// record is published on main, by main's own run-record.ts, as a results-only
// commit there.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { readOutcome } from "./background.ts";
import { admission, benchWithLock, FULL_MD, measureJob, publishAt, publishRecord, resultsCommit, RUNS, slowerRows, type MeasureJob, type MeasureOutcome } from "./bench.ts";
import { Git } from "./git.ts";
import { checkoutIn, ENV, publishEveryRun, repository, stubBench } from "./repository-fixture.ts";
import { candidateEnvironmentFixture } from "./run-environment-fixture.ts";
import { hostEnvironment } from "../gate/canonical-environment.ts";
import { readLedger } from "../gate/memory-ledger.ts";
import { useOwnMemory } from "../gate/test-memory.ts";

function scratch(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
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
  const memory = useOwnMemory(join(root, "memory"));
  // A stand-in with-lock.sh in the measured tree: it says what it was asked to
  // run, inside which reservation and by which history, and admits it or
  // refuses it as the test says.
  writeFileSync(join(gate, "with-lock.sh"), [
    'printf "%s\\n" "$@" > "$(dirname "$0")/argv"',
    'printf "%s\\n" "$NTS_MEMORY_PRIORITY" "${NTS_MEMORY_RESERVATION:+a reservation}" "$NTS_GATE_COSTS_DIR" > "$(dirname "$0")/memory"',
    'if [ -e "$(dirname "$0")/refuse" ]; then echo "with-lock: pid 4242 is measuring; not starting another" >&2; exit 75; fi',
    'echo "nts-bench measured"',
    "",
  ].join("\n"));
  const bench = benchWithLock(join(run, "nts-bench"), history);
  assert.deepEqual(bench(tree, run), { admitted: true, status: 0 });
  assert.deepEqual(readFileSync(join(gate, "argv"), "utf8").split("\n").filter(Boolean), [join(run, "nts-bench"), "--root", tree]);
  assert.deepEqual(readFileSync(join(gate, "memory"), "utf8").split("\n").filter(Boolean), ["full-check", "a reservation", history],
    "the session holds its memory before the lock admits it, at the full check's priority, sized by the history it is given");
  assert.equal(readLedger(memory.NTS_MEMORY_LEDGER).admitted.filter(entry => entry.live).length, 0, "the session's reservation ends with it");
  writeFileSync(join(gate, "refuse"), "");
  assert.deepEqual(bench(tree, run), { admitted: false, reason: "with-lock: pid 4242 is measuring; not starting another" });
  // Between the two, what the ledger says of the first session's reservation, which ended with it.
  assert.match(readFileSync(join(run, "bench.log"), "utf8"), /^nts-bench measured\n(?:memory: .*\n)*with-lock: pid 4242 is measuring/);
});

test("why a run was not admitted is the last refusal its log gives, the lock's or nts-bench's", () => {
  const waiting = "with-lock: waiting for CPUs 4-5 to run no other program and stay at least 90% idle on average for 45 s (limit 180 s)";
  assert.equal(admission(`${waiting}\nwith-lock: CPUs 4-5 did not become quiet; releasing the measurement lock without starting a run\n`),
    "with-lock: CPUs 4-5 did not become quiet; releasing the measurement lock without starting a run");
  assert.equal(admission(`${waiting}\nnot admitted: another program ran on CPU 5, its sibling, before this run started\n`),
    "not admitted: another program ran on CPU 5, its sibling, before this run started");
  assert.equal(admission(""), "exit 75, and the log says no more");
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
