/*---
description: "A generic Record input and returned owner preserve natural-logarithm special results."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-record, ts-generics, ts-generic-constraints, ts-objects, ts-type-aliases]
---*/
// A constrained Record field supplies logarithm inputs; node logs actual field values, exact special results and the retained generic owner.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number][] = [
  [0, -Infinity], [-0, -Infinity], [1, 0], [Infinity, Infinity],
  [-Infinity, NaN], [NaN, NaN], [-0.5, NaN], [-1.5, NaN],
  [-2.5, NaN], [-5e-324, NaN], [-2147483649, NaN], [-4503599627370496, NaN],
  [-9007199254740992, NaN], [-1.7976931348623157e+308, NaN],
];
type LogOutput<T> = { owner: T; result: number };
function compute<T extends Record<"value", number>>(input: T, position: number, log: unknown[]): LogOutput<T> {
  log.push("input", input.value); const result = Math.log(input.value); log.push("computed", result); return { owner: input, result };
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], input: Record<"value", number> = { value: row[0] }, log: unknown[] = [], output = compute(input, position, log);
  same(output.owner, input); same(output.owner.value, row[0]); same(output.result, row[1]); exact(log, ["input", row[0], "computed", row[1]]);
}
