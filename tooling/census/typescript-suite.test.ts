// The TypeScript conformance suite's selection and oracle:
//
//   node --test tooling/census/typescript-suite.test.ts
//
// The oracle is what keeps a wrong case out of the suite, so it is held to
// both answers: a right case passes it, and a case whose expectation is wrong
// does not -- whatever nts would make of either.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { oracle, selectTypescript } from "./suites/typescript.ts";
import { newTestScratch } from "../gate/test-scratch.ts";

const scratch = () => {
  return newTestScratch("typescript-suite");
};

const RIGHT = `/*---
description: right
features: [ts-enum]
---*/
enum Color { Red, Green }
assert.sameValue(Color.Green, 1);
`;

const WRONG = `/*---
description: wrong
features: [ts-enum]
---*/
enum Color { Red, Green }
assert.sameValue(Color.Green, 2);
`;

test("the oracle admits a case node passes", () => {
  const dir = scratch();
  try {
    assert.deepEqual(oracle(RIGHT, dir), { ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the oracle refuses a case whose expectation is wrong, naming what node said", () => {
  const dir = scratch();
  try {
    const verdict = oracle(WRONG, dir);
    assert.equal(verdict.ok, false);
    assert.match(verdict.ok ? "" : verdict.why, /Test262Error|Expected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the selection reads every case under a directory, with its features, sorted", () => {
  const root = scratch();
  try {
    mkdirSync(join(root, "tests/typescript/b"), { recursive: true });
    mkdirSync(join(root, "tests/typescript/a"), { recursive: true });
    writeFileSync(join(root, "tests/typescript/b/one.ts"), RIGHT);
    writeFileSync(join(root, "tests/typescript/a/two.ts"), WRONG.replace("[ts-enum]", "[ts-enum, ts-namespace]"));
    writeFileSync(join(root, "tests/typescript/a/notes.md"), "not a case");
    const selected = selectTypescript(root, "tests/typescript");
    assert.deepEqual(
      selected.map((record) => [record.path, record.features]),
      [
        ["tests/typescript/a/two.ts", ["ts-enum", "ts-namespace"]],
        ["tests/typescript/b/one.ts", ["ts-enum"]],
      ],
    );
    assert.equal(selected[0].variant_id, "tests/typescript/a/two.ts#strict");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the TypeScript oracle preserves its authored extension and ESM goal", () => {
  const root = scratch();
  try {
    const cases = join(root, "tests/typescript");
    const execution = join(root, "execution");
    mkdirSync(cases, {recursive: true});
    mkdirSync(execution);
    const source = RIGHT + "\nassert.sameValue(this === undefined, true);\n";
    writeFileSync(join(cases, "control.ts"), source);
    const selected = selectTypescript(root, "tests/typescript");
    assert.equal(selected.length, 1);
    assert.deepEqual(oracle(source, execution), {ok: true});
    const entries = readdirSync(execution).filter(name => /^oracle\.(?:ts|mts|cts|tsx)$/.test(name));
    assert.equal(entries.length, 1);
    assert.equal(extname(entries[0]!), extname(selected[0]!.path), "the oracle must not change the authored grammar");
    assert.equal(JSON.parse(readFileSync(join(execution, "package.json"), "utf8")).type, "module");
    assert.match(readFileSync(join(execution, entries[0]!), "utf8"), /export \{\};\s*$/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
