// node --test tooling/full-check/records.test.ts
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { recordAt } from "./records.ts";
import { repository } from "./repository-fixture.ts";

test("a recorder that rewrites a tracked record commits it whole, whatever git lists first", t => {
  // git status gives " M <path>" for an unstaged change: the first column is a
  // space, and a trimmed listing cut the path's first letter off, so the file
  // read as outside the records.
  const repo = repository(t);
  const commit = repo.commit({ "results/benchmarks/c/outcomes.tsv": "row 1\n" }, "a record");
  const recorded = recordAt(repo.git, commit, tree => { writeFileSync(join(tree, "results/benchmarks/c/outcomes.tsv"), "row 1\nrow 2\n"); return { status: 0, output: "" }; }, "records\n");
  assert.equal(recorded.kind, "committed", JSON.stringify(recorded));
  assert.deepEqual(recorded.kind === "committed" && [recorded.files, recorded.refused], [["results/benchmarks/c/outcomes.tsv"], []]);
});

test("a recorder that writes nothing commits nothing, and one at the wrong commit is refused", t => {
  const repo = repository(t);
  const commit = repo.commit({ "a": "1\n" }, "one");
  assert.deepEqual(recordAt(repo.git, commit, () => ({ status: 0, output: "" }), "records\n"), { kind: "none", status: 0, output: "" });
  mkdirSync(join(repo.dir, "results"), { recursive: true });
  const outside = recordAt(repo.git, commit, tree => { writeFileSync(join(tree, "elsewhere.txt"), "x\n"); return { status: 1, output: "no" }; }, "records\n");
  assert.deepEqual(outside, { kind: "refused", refused: ["elsewhere.txt"], output: "no", status: 1 });
  const later = repo.commit({ "a": "2\n" }, "two");
  assert.throws(() => recordAt(repo.git, commit, () => ({ status: 0, output: "" }), "records\n"), /is at .* not the run's/);
  assert.ok(later);
});
