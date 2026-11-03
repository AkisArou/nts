/*---
description: "A generic middle tuple spread stored in a class field preserves number and bigint slots independently of later source writes."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-variadic-tuples, ts-generics, ts-generic-constraints, ts-class, ts-class-fields, ts-this, ts-tuples, ts-spread, ts-numbers, ts-bigint, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// [string, ...T, boolean] crosses a class field; node copies both middle slots, keeps -0/NaN and wide bigints, and separates later writes in either direction.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
class Middle<T extends unknown[]> {
  values: [string, ...T, boolean];
  constructor(source: T) { this.values = ["head", ...source, true]; }
}
const rows: [number, bigint][] = [[-0, 0n], [NaN, 9007199254740993n], [2.5, -3n]];
for (const row of rows) {
  const source: [number, bigint] = [row[0], row[1]], route = new Middle(source);
  source[0] = 17; source[1] = 99n;
  same(route.values.length, 4); same(Array.isArray(route.values), true); same(Object.is(route.values, source), false);
  same(route.values[0], "head"); same(route.values[1], row[0]); same(route.values[2], row[1]); same(route.values[3], true);
  route.values[1] = -0; route.values[2] = 7n;
  same(route.values[1], -0); same(route.values[2], 7n); same(source[0], 17); same(source[1], 99n);
}
