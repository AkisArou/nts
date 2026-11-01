/*---
description: Control for bounds-string-field-relative; make absence explicit before reading.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-strings, ts-interfaces, ts-arrays, ts-tuples, ts-numbers, ts-objects, ts-arrow-functions]
---*/
// Explicit relative-index normalization and length checks select a code unit or undefined; recorded keys state presence.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [string, string[], string][] = [
  ["", [], '\"\"'], ["A", ["A"], '\"A\"'],
  ["\uD83D\uDE00Z", ["\uD83D", "\uDE00", "Z"], '\"\uD83D\uDE00Z\"'], ["\uD800", ["\uD800"], '\"\\ud800\"']
];
interface BoundsText { text: string; }
function read(holder: BoundsText, offset: number): string | undefined { const n = Number.isNaN(offset) ? 0 : Math.trunc(offset), index = n < 0 ? holder.text.length + n : n; return index >= 0 && index < holder.text.length ? holder.text[index] : undefined; }
for (const [text, units, json] of rows) {
  const holder: BoundsText = { text }, keys = units.map((unit, index) => String(index));
  assert.compareArray(keys, units.map((unit, index) => String(index))); same(JSON.stringify(holder), '{"text":' + json + '}');
  const positions: [number, number][] = [[-Infinity, -1], [-text.length - 1, -1], [-text.length, 0], [-1, text.length - 1], [0.8, 0], [text.length, -1], [NaN, 0], [Infinity, -1]];
  for (const [offset, slot] of positions) same(read(holder, offset), slot >= 0 && slot < units.length ? units[slot] : undefined);
  for (const index of [0, text.length]) {
    same(keys.includes(String(index)), index < units.length); same(keys.includes(String(index)), index < units.length);
  }
  same(holder.text.length, units.length);
}
