import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gateSteps, owed, TREE_CHECKS } from "./owed.mjs";
import { preciseChange } from "./precise-changes.ts";

const change = (path: string, before: string, after: string) => ({ path, before, after, sameMode: true });
const steps = (path: string, before: string, after: string) => gateSteps(owed([change(path, before, after)]));

test("documentation and notebook records owe only declared tree checks", () => {
  const listed = spawnSync(process.execPath, ["tooling/gate/run.mjs", "--tree-only"], { encoding: "utf8" });
  assert.equal(listed.status, 0);
  for (const path of ["docs/architecture.md", "docs/records/notebooks/new.md", "AGENTS.md", "README.md"]) {
    const got = gateSteps(owed([{ path, added: true }]));
    assert.deepEqual(got, TREE_CHECKS);
    for (const name of got) assert.ok(listed.stdout.split(/\s+/).includes(name), name);
  }
});

test("classification prose owes audit without record replay, class/match edits owe records", () => {
  for (const path of ["tooling/census/features.json", "tooling/census/test262-exclusions.json"]) {
    const text = readFileSync(path, "utf8"), old = JSON.parse(text), updated = structuredClone(old);
    if (old.features) updated.features["AggregateError"].authority = "docs/language/boundaries.md";
    else updated.exclusions[0].reason += " Revised explanation.";
    const got = steps(path, text, JSON.stringify(updated));
    assert.deepEqual(got, TREE_CHECKS);
    assert.ok(!got.includes("build"));
    if (old.features) updated.features["AggregateError"].class = "supported";
    else updated.exclusions[0].match = "other.js";
    const meaning = steps(path, text, JSON.stringify(updated));
    for (const name of ["audit", "test262", "test262-cases", "test262-builtins-cases", "test262-rest-cases", "test262-jvm", "test262-wasm", "test262-llvm", "typescript-cases"]) assert.ok(meaning.includes(name), name);
  }
});

test("unknown classification fields, invalid JSON and modes retain existing obligations", () => {
  const path = "tooling/census/features.json", text = readFileSync(path, "utf8");
  const updated = JSON.parse(text);
  updated.features.AggregateError.new_selector = "meaning";
  assert.equal(preciseChange(change(path, text, JSON.stringify(updated))), null);
  assert.equal(preciseChange(change(path, text, "{")), null);
  assert.equal(preciseChange({ ...change("tooling/config/x.ts", "// old\nlet x;", "// new\nlet x;"), sameMode: false }), null);
});

test("Rust prose owes its own doctests but no compiler or backend runs", () => {
  const rules = owed([change("compiler/core/src/hir/escape.rs", "/// old\nfn f() {}", "/// new\nfn f() {}")]);
  assert.deepEqual(gateSteps(rules), [...TREE_CHECKS, "doctests"]);
  assert.deepEqual(rules.flatMap((r: {doctests?: string[]}) => r.doctests ?? []), ["nts-core"]);
  assert.ok(steps("compiler/core/src/hir/escape.rs", "fn f() { a(); }", "fn f() { b(); }").includes("memory"));
});

test("ordinary C/TypeScript comments narrow; fixtures and unknown syntax stay guarded", () => {
  for (const path of ["tooling/example.c", "tooling/example.ts"]) {
    assert.deepEqual(steps(path, "// old\n", "// new\n"), TREE_CHECKS);
  }
  const fixture = steps("tests/programs/arith/src/main.ts", "// old\n", "// new\n");
  assert.ok(fixture.includes("examples"));
  assert.ok(steps("tooling/cli/unsupported.ts", "let r=/a/; // old", "let r=/a/; // new").includes("build"));
  const mixed = gateSteps(owed([{ path: "docs/new.md", added: true }, { path: "compiler/core/src/hir/escape.rs" }]));
  for (const name of ["memory", "rc", "llvm-rc", "tests"]) assert.ok(mixed.includes(name), name);
});

test("fixture front matter still owes TypeScript records and backend markers owe outcomes", () => {
  assert.ok(steps("tests/typescript/enums/main.ts", "/*--- features: [ts-enum] ---*/\n", "/*--- features: [ts-namespace] ---*/\n").includes("typescript-cases"));
  assert.ok(steps("tests/outcomes/example/main.ts", "// backend: c\n", "// backend: llvm\n").includes("outcomes"));
  assert.ok(steps("tooling/example.ts", "// backend: c\n", "// backend: llvm\n").includes("build"));
});
