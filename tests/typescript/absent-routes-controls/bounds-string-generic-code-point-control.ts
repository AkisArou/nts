/*---
description: Control for bounds-string-generic-code-point; make absence explicit before reading.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-strings, ts-generics, ts-generic-constraints, ts-arrays, ts-tuples, ts-numbers, ts-objects, ts-arrow-functions]
---*/
// Explicit bounds make every missing code point undefined before any string operation; valid code-point reads retain the same semantics.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [string, number[], string][] = [["", [], '\"\"'], ["A", [65], '\"A\"'], ["\uD83D\uDE00Z", [128512, 56832, 90], '\"\uD83D\uDE00Z\"'], ["\uD800", [55296], '\"\\ud800\"']];
function read<T extends string>(text: T, index: number): number | undefined { const i = Number.isNaN(index) ? 0 : Math.trunc(index); return i >= 0 && i < text.length ? text.codePointAt(i) : undefined; }
for (const [text, points, json] of rows) {
  const keys = points.map((point, index) => String(index));
  assert.compareArray(keys, points.map((point, index) => String(index))); same(JSON.stringify(text), json);
  const positions: [number, number][] = [[-Infinity, -1], [-1, -1], [-0, 0], [0.8, 0], [1, 1], [2, 2], [text.length, -1], [NaN, 0], [Infinity, -1]];
  for (const [index, slot] of positions) same(read(text, index), slot >= 0 && slot < points.length ? points[slot] : undefined);
  for (const index of [0, text.length]) {
    same(keys.includes(String(index)), index < points.length); same(keys.includes(String(index)), index < points.length);
  }
  same(text.length, points.length);
}
