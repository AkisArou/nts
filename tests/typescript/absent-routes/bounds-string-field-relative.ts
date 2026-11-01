/*---
description: A string field preserves negative at offsets and missing code-unit results.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-strings, ts-interfaces, ts-arrays, ts-tuples, ts-numbers, ts-objects, ts-arrow-functions]
---*/
// A typed string field reaches at; node reads negative offsets from the end and returns undefined beyond either boundary.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [string, string[], string][] = [
  ["", [], '\"\"'], ["A", ["A"], '\"A\"'],
  ["\uD83D\uDE00Z", ["\uD83D", "\uDE00", "Z"], '\"\uD83D\uDE00Z\"'], ["\uD800", ["\uD800"], '\"\\ud800\"']
];
interface BoundsText { text: string; }
function read(holder: BoundsText, offset: number): string | undefined { return holder.text.at(offset); }
for (const [text, units, json] of rows) {
  const holder: BoundsText = { text }, boxed = new String(text), keys = Object.keys(boxed);
  assert.compareArray(keys, units.map((unit, index) => String(index))); same(JSON.stringify(holder), '{"text":' + json + '}');
  const positions: [number, number][] = [[-Infinity, -1], [-text.length - 1, -1], [-text.length, 0], [-1, text.length - 1], [0.8, 0], [text.length, -1], [NaN, 0], [Infinity, -1]];
  for (const [offset, slot] of positions) same(read(holder, offset), slot >= 0 && slot < units.length ? units[slot] : undefined);
  for (const index of [0, text.length]) {
    same(index in boxed, index < units.length); same(Object.hasOwn(boxed, index), index < units.length);
  }
  same(holder.text.length, units.length);
}
