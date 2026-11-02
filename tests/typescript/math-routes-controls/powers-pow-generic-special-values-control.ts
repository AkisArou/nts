/*---
description: "Control for powers-pow-generic-special-values; A constrained generic preserves every prescribed power special case through two input layouts and a returned result."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-generics, ts-generic-constraints, ts-interfaces, ts-objects, ts-type-aliases]
---*/
// Generic base/exponent records carry power edge inputs; node logs inputs and prescribed results, preserving returned owner identity and zero signs. The control retains the route and selects the result by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, number][] = [
  [NaN, 0, 1], [NaN, -0, 1], [NaN, 1, NaN], [NaN, -1, NaN],
  [1, NaN, NaN], [0, NaN, NaN], [-0, NaN, NaN], [Infinity, NaN, NaN],
  [-Infinity, NaN, NaN], [NaN, NaN, NaN], [0, 0, 1], [-0, -0, 1],
  [Infinity, -0, 1], [-Infinity, 0, 1], [-2, -0, 1], [0, 3, 0],
  [0, -3, Infinity], [-0, 3, -0], [-0, -3, -Infinity], [-0, 2, 0],
  [-0, -2, Infinity], [-0, 0.5, 0], [-0, -0.5, Infinity], [-0, 1.5, 0],
  [-0, -2.5, Infinity], [-0, Infinity, 0], [-0, -Infinity, Infinity], [-0, 9007199254740991, -0],
  [-0, 9007199254740992, 0], [-0, 9007199254740994, 0], [-0, -9007199254740991, -Infinity], [-0, -9007199254740992, Infinity],
  [-0, 4294967297, -0], [-0, -2147483649, -Infinity], [Infinity, 3, Infinity], [Infinity, -3, 0],
  [-Infinity, 3, -Infinity], [-Infinity, -3, -0], [-Infinity, 2, Infinity], [-Infinity, -2, 0],
  [-Infinity, 0.5, Infinity], [-Infinity, -0.5, 0], [-Infinity, Infinity, Infinity], [-Infinity, -Infinity, 0],
  [1, Infinity, NaN], [-1, Infinity, NaN], [1, -Infinity, NaN], [-1, -Infinity, NaN],
  [2, Infinity, Infinity], [-2, Infinity, Infinity], [2, -Infinity, 0], [-2, -Infinity, 0],
  [0.5, Infinity, 0], [-0.5, Infinity, 0], [0.5, -Infinity, Infinity], [-0.5, -Infinity, Infinity],
  [5e-324, Infinity, 0], [-5e-324, -Infinity, Infinity], [1.7976931348623157e+308, Infinity, Infinity], [-1.7976931348623157e+308, -Infinity, 0],
  [-1, 0.5, NaN], [-8, -0.5, NaN], [-1.7976931348623157e+308, 1.5, NaN], [-5e-324, -2.5, NaN],
  [4503599627370496, 0, 1], [-4503599627370496, -0, 1], [2147483648, 0, 1], [4294967297, -0, 1],
  [1.0000000000000002, Infinity, Infinity], [0.9999999999999999, Infinity, 0], [-1.0000000000000002, -Infinity, 0], [-0.9999999999999999, -Infinity, Infinity],
  [-Infinity, 9007199254740991, -Infinity], [-Infinity, -9007199254740991, -0], [-Infinity, 9007199254740992, Infinity], [-Infinity, -9007199254740992, 0],
];
interface PowerInput { base: number; exponent: number; }
type PowerOutput<T> = { owner: T; result: number };
function compute<T extends PowerInput>(input: T, position: number, log: unknown[]): PowerOutput<T> {
  log.push("input", input.base, input.exponent); const result = rows[position][2]; log.push("computed", result); return { owner: input, result };
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: unknown[] = [], plain: PowerInput = { base: row[0], exponent: row[1] }, tagged = { base: row[0], exponent: row[1], label: "kept" };
  const first = compute(plain, position, log), second = compute(tagged, position, log);
  same(first.owner, plain); same(second.owner, tagged); same(second.owner.label, "kept"); same(first.owner.base, row[0]); same(second.owner.exponent, row[1]);
  same(first.result, row[2]); same(second.result, row[2]); exact(log, ["input", row[0], row[1], "computed", row[2], "input", row[0], row[1], "computed", row[2]]);
}
