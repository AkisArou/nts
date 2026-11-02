/*---
description: Typed raw arrays distinguish zero parts, holes, missing substitutions and unused extra values.
features: [ts-template-routes, ts-template-route-escapes-raw, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-objects, ts-unknown, ts-interfaces, ts-unions, ts-numbers, ts-null-undefined, ts-conversions, ts-spread]
---*/
// String.raw function: an interface field carries arrays or numeric-length array-like strings; node floors bounded lengths, skips missing/extra substitutions and stringifies holes or explicit undefined exactly.
type Value = number | string | boolean | null | undefined | { toString(): string };
interface Row { raw: ArrayLike<string>; values: Value[]; result: string; }
function same(a: unknown, b: unknown): void { assert.sameValue(Object.is(a, b), true); assert.sameValue(typeof a, typeof b); }
function exact(a: readonly unknown[], b: readonly unknown[]): void { assert.compareArray(a, b); for (let i = 0; i < a.length; i++) same(a[i], b[i]); }
const log: unknown[] = [];
const extra = { toString(): string { log.push("extra"); return "BAD"; } };
const sparse: string[] = ["A"]; sparse.length = 3; sparse[2] = "C";
const rows: Row[] = [
  { raw: [], values: [extra], result: "" }, { raw: ["a"], values: [extra], result: "a" },
  { raw: ["a", "b"], values: [], result: "ab" }, { raw: ["a", "b"], values: [undefined], result: "aundefinedb" },
  { raw: ["a", "b"], values: [-0, extra], result: "a0b" }, { raw: ["a", "b"], values: [NaN], result: "aNaNb" },
  { raw: ["<", "|", ">"], values: [null, ""], result: "<null|>" }, { raw: sparse, values: ["x", "y"], result: "AxundefinedyC" },
  { raw: ["", "\\n", ""], values: [true, false], result: "true\\nfalse" },
  { raw: { length: 2.9, 0: "a", 1: "b", 2: "c" }, values: ["X", extra], result: "aXb" },
  { raw: { length: 0.5, 0: "a" }, values: [extra], result: "" },
  { raw: { length: -1, 0: "a" }, values: [extra], result: "" }, { raw: { length: NaN, 0: "a" }, values: [extra], result: "" }
];
function inspect(row: Row): void {
  log.length = 0; const source: { raw: ArrayLike<string> } = { raw: row.raw }, values: Value[] = row.values;
  same(source.raw, row.raw); same(values, row.values); for (let i = 0; i < values.length; i++) same(values[i], row.values[i]);
  const result = String.raw(source, ...values); same(result, row.result); exact(log, []); same(source.raw, row.raw); same(values, row.values);
}
for (const row of rows) inspect(row);
