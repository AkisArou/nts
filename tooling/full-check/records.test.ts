// node --test tooling/full-check/records.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listedRecords, recordAt } from "./records.ts";
import { repository } from "./repository-fixture.ts";

test("the pending and improved lines of a run's step logs are what it lists", t => {
  const run = mkdtempSync(join(tmpdir(), "full-check-run-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  // The exact lines of tooling/records/pending.ts's pendingLine and improvedLine.
  writeFileSync(join(run, "typescript-c.log"), [
    "  pending: tests/typescript/a/b.ts is not recorded in results/typescript/c/cases.tsv yet",
    "improved, record pending: tests/typescript/a/c.ts refused -> pass",
    "a line that says pending: but is no record line",
  ].join("\n"));
  writeFileSync(join(run, "outcomes.log"), "pending: tests/outcomes/x is not recorded in tests/outcomes/x/outcome.json yet\n");
  writeFileSync(join(run, "summary.json"), "pending: tests/outcomes/x is not recorded in nowhere yet\n");
  assert.deepEqual(listedRecords(run), {
    pending: ["tests/outcomes/x (tests/outcomes/x/outcome.json)", "tests/typescript/a/b.ts (results/typescript/c/cases.tsv)"],
    improved: ["tests/typescript/a/c.ts refused -> pass"],
  });
  assert.deepEqual(listedRecords(join(run, "missing")), { pending: [], improved: [] });
});

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
