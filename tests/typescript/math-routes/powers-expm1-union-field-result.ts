/*---
description: "Primitive and boxed numeric unions preserve expm1 results in a declared field."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-unions, ts-objects, ts-type-aliases]
---*/
// A union is narrowed before expm1 and the result crosses a typed field; node logs both arms and preserves -0 while mapping -Infinity to -1.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number][] = [
  [0, 0], [-0, -0], [Infinity, Infinity], [-Infinity, -1],
  [NaN, NaN],
];
type ExpInput = number | { value: number };
function compute(value: ExpInput, position: number, log: unknown[]): number {
  let input: number; if (typeof value === "number") { input = value; log.push("number"); } else { input = value.value; log.push("box"); }
  log.push("input", input); const result = Math.expm1(input); log.push("computed", result); return result;
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], inputs: ExpInput[] = [row[0], { value: row[0] }];
  for (let arm = 0; arm < inputs.length; arm++) {
    const log: unknown[] = [], output: { result: number } = { result: compute(inputs[arm], position, log) };
    same(output.result, row[1]); exact(log, [arm === 0 ? "number" : "box", "input", row[0], "computed", row[1]]);
  }
}
