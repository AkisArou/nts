// node --test tooling/full-check/records.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hostEnvironment } from "../gate/canonical-environment.ts";
import { appliedIn, DELTA_FILE } from "../records/delta.ts";
import { applyAt, applyRecords, recordAt, recordsMessage } from "./records.ts";
import { checkoutIn, ENV, repository } from "./repository-fixture.ts";
import { candidateEnvironmentFixture } from "./run-environment-fixture.ts";
import { Git } from "./git.ts";

test("what a recorder rewrites is named whole, whatever git lists first", t => {
  // git status gives " M <path>" for an unstaged change: the first column is a
  // space, and a trimmed listing cut the path's first letter off, so the file
  // read as outside the records.
  const repo = repository(t);
  const commit = repo.commit({ "results/benchmarks/c/outcomes.tsv": "row 1\n" }, "a record");
  const recorded = recordAt(repo.git, commit, tree => { writeFileSync(join(tree, "results/benchmarks/c/outcomes.tsv"), "row 1\nrow 2\n"); return { status: 0, output: "" }; });
  assert.deepEqual(recorded, { status: 0, output: "", files: ["results/benchmarks/c/outcomes.tsv"], refused: [] });
  assert.equal(repo.git.run(["rev-parse", "HEAD"]), commit, "recording commits nothing: its rows land from its delta");
});

test("a recorder that writes nothing wrote nothing, what it writes elsewhere is named, and one at the wrong commit is refused", t => {
  const repo = repository(t);
  const commit = repo.commit({ "a": "1\n" }, "one");
  assert.deepEqual(recordAt(repo.git, commit, () => ({ status: 0, output: "" })), { status: 0, output: "", files: [], refused: [] });
  const outside = recordAt(repo.git, commit, tree => { writeFileSync(join(tree, "elsewhere.txt"), "x\n"); return { status: 1, output: "no" }; });
  assert.deepEqual(outside, { status: 1, output: "no", files: [], refused: ["elsewhere.txt"] });
  repo.commit({ "a": "2\n" }, "two");
  assert.throws(() => recordAt(repo.git, commit, () => ({ status: 0, output: "" })), /is at .* not the run's/);
});

test("a delta is applied in the tree set up at main, and what it wrote under the records is committed on main", t => {
  const repo = repository(t);
  const recorded = repo.commit({ "results/a.tsv": "a\n" }, "recorded here");
  repo.git.run(["worktree", "add", "--detach", "-q", repo.layout.tree, recorded]);
  const tree = new Git(repo.layout.tree, ENV);
  // The recorder's own writes, left in the tree at the commit it recorded at.
  writeFileSync(join(repo.layout.tree, "results/a.tsv"), "a\nrecorded\n");
  const main = repo.commit({ "results/a.tsv": "a\nmain's own\n", "b.txt": "b\n" }, "main moved on");
  const applied = applyAt(tree, main, checkoutIn(repo), dir => {
    assert.equal(readFileSync(join(dir, "results/a.tsv"), "utf8"), "a\nmain's own\n", "the tree is main's, without the recorder's writes");
    writeFileSync(join(dir, "results/a.tsv"), "a\nmain's own\nrecorded\n");
    writeFileSync(join(dir, "stray.txt"), "not a record\n");
    return { status: 0, output: "record-pending --apply: 1 row(s) applied, 0 already recorded, 0 skipped; nothing is committed\n" };
  }, output => recordsMessage({ commit: recorded, part: "core", run: "/runs/core", main, attempt: 2, output }));
  assert.equal(applied.kind, "committed", JSON.stringify(applied));
  if (applied.kind !== "committed") return;
  assert.deepEqual([applied.files, applied.refused], [["results/a.tsv"], ["stray.txt"]]);
  assert.equal(repo.git.run(["rev-parse", `${applied.commit}^`]), main, "the records commit's parent is main");
  assert.deepEqual(repo.git.run(["diff", "--name-only", main, applied.commit]).split("\n"), ["results/a.tsv"]);
  const message = repo.git.run(["log", "-1", "--format=%B", applied.commit]);
  assert.match(message, new RegExp(`^records: the pending and accepted rows at ${recorded.slice(0, 12)}\n`));
  assert.match(message, new RegExp(`on main ${main.slice(0, 12)} \\(attempt 2\\):\n1 row\\(s\\) applied, 0 already recorded, 0 skipped\\.\n\nFull-check-run: /runs/core$`));
});

test("an apply that fails commits nothing, and one that applies nothing has nothing to commit", t => {
  const repo = repository(t);
  const earlier = repo.commit({ "results/a.tsv": "0\n" }, "earlier"), main = repo.commit({ "results/a.tsv": "a\n" }, "main");
  repo.git.run(["worktree", "add", "--detach", "-q", repo.layout.tree, main]);
  const tree = new Git(repo.layout.tree, ENV), message = () => "records\n";
  const failed = applyAt(tree, main, checkoutIn(repo), dir => { writeFileSync(join(dir, "results/a.tsv"), "half\n"); return { status: 1, output: "malformed records delta" }; }, message);
  assert.deepEqual([failed.kind, failed.status], ["failed", 1]);
  assert.deepEqual(applyAt(tree, main, checkoutIn(repo), () => ({ status: 0, output: "" }), message), { kind: "none", refused: [], output: "", status: 0 },
    "the next attempt starts from main again, without the failed one's writes");
  assert.equal(repo.git.run(["rev-parse", "HEAD"]), main);
  tree.run(["checkout", "--detach", "-q", earlier]);
  assert.throws(() => applyAt(tree, main, () => {}, () => ({ status: 0, output: "" }), message), /not main's/, "a tree its set-up left elsewhere is refused");
});

test("main's own --apply runs in the gate's canonical environment, with main's Node, in a temporary folder of its own", t => {
  const repo = repository(t), tree = join(repo.root, "tree"), run = join(repo.root, "run");
  mkdirSync(join(tree, "tooling/records"), { recursive: true });
  mkdirSync(run);
  candidateEnvironmentFixture(tree);
  // The fake --apply reports what it was given, then ends as the real one does.
  writeFileSync(join(tree, "tooling/records/record-pending.ts"), `import {existsSync} from "node:fs";
console.log(JSON.stringify({ canonical: !!process.env.NTS_GATE_ENV_CONTEXT, tmp: process.env.TMPDIR, there: existsSync(process.env.TMPDIR ?? ""), argv: process.argv.slice(2) }));
console.log("record-pending --apply: 2 row(s) applied, 1 already recorded, 0 skipped; nothing is committed");
`);
  const delta = join(run, DELTA_FILE), log = join(run, "record-pending.apply-1.log");
  const result = applyRecords(tree, delta, log, { env: { ...hostEnvironment(process.env), HOME: repo.root } });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(JSON.parse(result.output.split("\n")[0]!), { canonical: true, tmp: join(run, "records-apply", "tmp"), there: true, argv: ["--apply", delta] });
  assert.equal(readFileSync(log, "utf8"), result.output, "its output is its log");
  assert.deepEqual(appliedIn(result.output), { applied: 2, already: 1, skipped: 0 });
  assert.equal(existsSync(join(run, "records-apply", "tmp")), false, "its temporary folder goes after it");
});
