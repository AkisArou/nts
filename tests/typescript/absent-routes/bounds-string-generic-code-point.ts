/*---
description: A generic string reader keeps absent code points distinct from surrogate values.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-strings, ts-generics, ts-generic-constraints, ts-arrays, ts-tuples, ts-numbers, ts-objects, ts-arrow-functions]
---*/
// A generic string reaches codePointAt; node combines leading surrogate pairs, retains trailing/lone units and returns undefined past either end.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [string, number[], string][] = [["", [], '\"\"'], ["A", [65], '\"A\"'], ["\uD83D\uDE00Z", [128512, 56832, 90], '\"\uD83D\uDE00Z\"'], ["\uD800", [55296], '\"\\ud800\"']];
function read<T extends string>(text: T, index: number): number | undefined { return text.codePointAt(index); }
for (const [text, points, json] of rows) {
  const boxed = new String(text), keys = Object.keys(boxed);
  assert.compareArray(keys, points.map((point, index) => String(index))); same(JSON.stringify(text), json);
  const positions: [number, number][] = [[-Infinity, -1], [-1, -1], [-0, 0], [0.8, 0], [1, 1], [2, 2], [text.length, -1], [NaN, 0], [Infinity, -1]];
  for (const [index, slot] of positions) same(read(text, index), slot >= 0 && slot < points.length ? points[slot] : undefined);
  for (const index of [0, text.length]) {
    same(index in boxed, index < points.length); same(Object.hasOwn(boxed, index), index < points.length);
  }
  same(text.length, points.length);
}
