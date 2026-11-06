// node --test tooling/full-check/bench.test.ts
//
// What the service takes from a benchmark run: nts-bench's results-only
// commit on verified, nothing else, and the rows full.md marks slower than
// their own best.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resultsCommit, slowerRows } from "./bench.ts";
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
