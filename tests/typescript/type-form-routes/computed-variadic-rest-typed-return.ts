/*---
description: "A variadic rest parameter returns a destructured typed tail with exact slots and independent storage."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-variadic-tuples, ts-generics, ts-generic-constraints, ts-rest-parameters, ts-tuples, ts-destructuring, ts-spread, ts-numbers, ts-bigint, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// [string, ...T] enters a rest parameter and its destructured T tail crosses a typed return; node logs the head and tail and preserves a fresh mutable tuple.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
function tail<T extends unknown[]>(...input: [string, ...T]): T {
  const [head, ...values] = input; log.push("head", head, "tail", ...values); return values;
}
const rows: [number, bigint][] = [[-0, 0n], [NaN, 9007199254740993n], [2.5, -3n]];
for (const row of rows) {
  const input: [string, number, bigint] = ["tag", row[0], row[1]]; log.length = 0;
  const result: [number, bigint] = tail(...input);
  exact(log, ["head", "tag", "tail", row[0], row[1]]);
  same(result.length, 2); same(Array.isArray(result), true); same(Object.is(result, input), false);
  input[1] = 17; input[2] = 99n;
  same(result[0], row[0]); same(result[1], row[1]); same(input[0], "tag");
  result[0] = -0; result[1] = 7n;
  same(result[0], -0); same(result[1], 7n); same(input[1], 17); same(input[2], 99n);
}
