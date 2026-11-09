// The test262 fail rows a records run added, said aloud: which rows they are,
// how the task line counts them, and the full list it names.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { testScratch } from "../gate/test-scratch.ts";
import type { Delta, DeltaRow } from "./delta.ts";
import { newTest262Fails, newTest262FailsTask, test262Directory, writeNewFails } from "./test262-fails.ts";

const row = (record: string, after: string, before: string | null = null, kind = "test262"): DeltaRow => {
  const path = after.split("\t")[0]!;
  return { kind, record, case: path, key: path, before, after, sources: "0".repeat(64) };
};
const LANGUAGE = "results/test262/c/language.tsv", BUILTINS = "results/test262/jvm/builtins.tsv";

test("a delta's new test262 fail rows are the cases with no row before that run now and fail", () => {
  const delta: Delta = { version: 1, commit: null, headers: {}, rows: [
    row(LANGUAGE, "test/language/expressions/class/a.js\tfail\tuncaught Test262Error: #1"),
    row(LANGUAGE, "test/language/expressions/class/b.js\tpass\t"),
    row(LANGUAGE, "test/language/statements/for/c.js\tpass\t", "test/language/statements/for/c.js\tfail\tuncaught Test262Error: #2"),
    row(BUILTINS, "test/built-ins/Array/d.js\tfail\taccepted: ran and threw Test262Error"),
    row("tests/outcomes/x/outcome.json", "{}", null, "outcomes"),
  ] };
  assert.deepEqual(newTest262Fails(delta), [
    { record: LANGUAGE, path: "test/language/expressions/class/a.js", detail: "uncaught Test262Error: #1" },
    { record: BUILTINS, path: "test/built-ins/Array/d.js", detail: "accepted: ran and threw Test262Error" },
  ], "a new pass, a fixed fail and another kind's row are not new fails");
});

test("the task line counts them per record and per directory, and names their full list", t => {
  const fails = [
    { record: LANGUAGE, path: "test/language/expressions/class/a.js", detail: "uncaught Test262Error: #1" },
    { record: LANGUAGE, path: "test/language/expressions/new/b.js", detail: "uncaught TypeError" },
    { record: LANGUAGE, path: "test/language/statements/c.js", detail: "uncaught Test262Error: #2" },
    { record: BUILTINS, path: "test/built-ins/Array/d.js", detail: "accepted: ran and threw Test262Error" },
  ];
  const list = join(testScratch(t, "test262-fails"), "test262-new-fails.tsv");
  assert.equal(newTest262FailsTask(fails, "a".repeat(40), list),
    `- test262 records at ${"a".repeat(12)} added 4 fail row(s), cases that run now and fail, any of which may be a refusal turned wrong: `
    + `${LANGUAGE}: test/language/expressions 2, test/language/statements 1; ${BUILTINS}: test/built-ins/Array 1. The full list is ${list}.`);
  assert.equal(newTest262FailsTask([], "a".repeat(40), list), null, "no new fail row, no task");
  writeNewFails(fails, list);
  assert.deepEqual(readFileSync(list, "utf8").split("\n"), [...fails.map(one => `${one.record}\t${one.path}\t${one.detail}`), ""]);
  assert.equal(test262Directory("test/harness/x.js"), "test/harness", "a shallow case counts under its own directory");
});
