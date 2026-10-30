import test from "node:test";
import assert from "node:assert/strict";
import { groupFindings, hashProgram, normalizeNames } from "./grouping.ts";

test("grouping merges alpha-renamed programs with comments and formatting removed", () => {
  const first = `export function subject(n: number): number { const xs: number[] = [n, 2]; return xs[0]; }`;
  const second = `// a reduction\nexport function renamed(value: number): number {\n const array: number[] = [value,2];\n return array[0];\n}`;
  assert.equal(normalizeNames(first), normalizeNames(second));
  const base = { cell: "bounds:call", template: "guarded-read", kind: "wrong-answer" };
  const groups = groupFindings([
    { ...base, backends: ["llvm", "c"], source: first },
    { ...base, backends: ["c", "llvm", "c"], source: second },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].findings.length, 2);
});

test("binding scopes distinguish shadowed references", () => {
  const outer = `export function f(x: number): number { let total: number = x; { let x: number = 2; total += x; } return total; }`;
  const renamed = `export function go(y: number): number { let sum: number = y; { let z: number = 2; sum += z; } return sum; }`;
  const wrongReference = `export function go(y: number): number { let sum: number = y; { let z: number = 2; sum += y; } return sum; }`;
  assert.equal(hashProgram(outer), hashProgram(renamed));
  assert.notEqual(hashProgram(outer), hashProgram(wrongReference));
});

test("property names, free names, signs, values and types survive canonicalization", () => {
  for (const [left, right] of [
    [`function f(x: { a: number }): number { return x.a; }`, `function f(x: { b: number }): number { return x.b; }`],
    [`function f(): number { return Math.floor(1.5); }`, `function f(): number { return Math.round(1.5); }`],
    [`function f(): number { return -0; }`, `function f(): number { return 0; }`],
    [`function f(): number { return NaN; }`, `function f(): number { return 0; }`],
    [`function f(x: number): number { return x; }`, `function f(x: 1): number { return x; }`],
    [`function f(a: number) { return {a}; }`, `function f(b: number) { return {b}; }`],
    [`import {foo} from "m"; export function f(): number { return foo(); }`, `import {bar} from "m"; export function f(): number { return bar(); }`],
  ]) assert.notEqual(hashProgram(left), hashProgram(right));
});

test("class names normalize in runtime uses and type annotations but fields stay named", () => {
  const one = `class Box { items: number[] = [1]; } function f(b: Box): number { return b.items.length; } export function go(): number { return f(new Box()); }`;
  const two = `class Holder { items: number[] = [1]; } function read(h: Holder): number { return h.items.length; } export function work(): number { return read(new Holder()); }`;
  assert.equal(hashProgram(one), hashProgram(two));
  assert.notEqual(hashProgram(one), hashProgram(two.replaceAll("items", "values")));
});

test("cell, template, failure kind and backend set remain separate grouping axes", () => {
  const base = { cell: "bounds:call", template: "guarded-read", kind: "wrong-answer", backends: ["c"], source: "export function f(): number { return 1; }" };
  assert.equal(groupFindings([
    base,
    { ...base, cell: "bounds:alias" },
    { ...base, template: "range-join" },
    { ...base, kind: "abort" },
    { ...base, backends: ["llvm"] },
  ]).length, 5);
});
