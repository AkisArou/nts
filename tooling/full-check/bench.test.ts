// node --test tooling/full-check/bench.test.ts
//
// How the service asks for a benchmark run -- the measurement lock and
// nothing else -- and what it takes from one: nts-bench's results-only commit
// on verified, nothing else, and the rows full.md marks slower than their own
// best.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { admission, benchWithLock, resultsCommit, slowerRows } from "./bench.ts";
import { repository, stubBench } from "./repository-fixture.ts";

test("the results-only commit on verified is the run to submit; anything else is named", t => {
  const repo = repository(t);
  const run = mkdtempSync(join(tmpdir(), "full-check-bench-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
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

test("the nightly waits for the reserved core alone: with-lock.sh asked without --wait, then nts-bench, and no idle wait on the machine; exit 75 is a run that did not start", t => {
  const root = mkdtempSync(join(tmpdir(), "full-check-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const gate = join(root, "controller/tooling/gate"), target = join(root, "target"), tree = join(root, "tree"), run = join(root, "run");
  for (const dir of [gate, tree, run]) mkdirSync(dir, { recursive: true });
  // A stand-in with-lock.sh: it says what it was asked to run, and admits it or refuses it as the test says.
  writeFileSync(join(gate, "with-lock.sh"), [
    'printf "%s\\n" "$@" > "$(dirname "$0")/argv"',
    'if [ -e "$(dirname "$0")/refuse" ]; then echo "with-lock: pid 4242 is measuring; not starting another" >&2; exit 75; fi',
    'echo "nts-bench measured"',
    "",
  ].join("\n"));
  const bench = benchWithLock(join(root, "controller"), target);
  assert.deepEqual(bench(tree, run), { admitted: true, status: 0 });
  assert.deepEqual(readFileSync(join(gate, "argv"), "utf8").split("\n").filter(Boolean), [join(target, "release/nts-bench"), "--root", tree]);
  writeFileSync(join(gate, "refuse"), "");
  assert.deepEqual(bench(tree, run), { admitted: false, reason: "with-lock: pid 4242 is measuring; not starting another" });
  assert.match(readFileSync(join(run, "bench.log"), "utf8"), /^nts-bench measured\nwith-lock: pid 4242 is measuring/);
});

test("why a run was not admitted is the last refusal its log gives, the lock's or nts-bench's", () => {
  const waiting = "with-lock: waiting for CPUs 4-5 to run no other program and stay at least 90% idle on average for 45 s (limit 180 s)";
  assert.equal(admission(`${waiting}\nwith-lock: CPUs 4-5 did not become quiet; releasing the measurement lock without starting a run\n`),
    "with-lock: CPUs 4-5 did not become quiet; releasing the measurement lock without starting a run");
  assert.equal(admission(`${waiting}\nnot admitted: another program ran on CPU 5, its sibling, before this run started\n`),
    "not admitted: another program ran on CPU 5, its sibling, before this run started");
  assert.equal(admission(""), "exit 75, and the log says no more");
});
