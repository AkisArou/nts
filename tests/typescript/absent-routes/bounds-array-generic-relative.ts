/*---
description: A generic optional-element reader preserves at normalization and absent results.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-generics, ts-readonly, ts-unions, ts-numbers, ts-strings, ts-objects, ts-tuples]
---*/
// A generic reads dense optional elements with at; node truncates offsets, maps NaN to zero and returns undefined outside either end.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type BoundsValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 };
const rows: [BoundsValue, string][] = [[undefined, "null"], [null, "null"], [0, "0"], [-0, "0"], ["", '""'], [NaN, "null"], [false, "false"], [marker, '{"id":7}']];
function relative<T>(xs: readonly (T | undefined)[], offset: number): T | undefined { return xs.at(offset); }
const offsets: [number, boolean][] = [[-Infinity, false], [-3, false], [-2, true], [-1, false], [-0, true], [0.8, true], [1.8, false], [2, false], [NaN, true], [Infinity, false]];
for (const [value, json] of rows) {
  const source: (BoundsValue | undefined)[] = [value, undefined], keys = Object.keys(source);
  assert.compareArray(keys, ["0", "1"]); same(JSON.stringify(source), "[" + json + ",null]");
  for (const [offset, first] of offsets) same(relative(source, offset), first ? value : undefined);
  for (const [index, present] of [[0, true], [1, true], [2, false], [-1, false]]) {
    same(String(index) in source, present); same(Object.hasOwn(source, String(index)), present);
  }
  same(source.length, 2);
}
