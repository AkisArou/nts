/*---
description: Control for bounds-string-field-char-at; make absence explicit before reading.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-strings, ts-interfaces, ts-arrays, ts-tuples, ts-numbers, ts-objects, ts-arrow-functions]
---*/
// Explicit normalization and length checks select a real code unit or the empty-string sentinel; recorded keys retain presence.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [string, string[], string][] = [
  ["", [], '\"\"'], ["A", ["A"], '\"A\"'],
  ["\uD83D\uDE00Z", ["\uD83D", "\uDE00", "Z"], '\"\uD83D\uDE00Z\"'], ["\uD800", ["\uD800"], '\"\\ud800\"']
];
interface BoundsText { text: string; }
function read(holder: BoundsText, index: number): string { const i = Number.isNaN(index) ? 0 : Math.trunc(index); return i >= 0 && i < holder.text.length ? holder.text[i] : ""; }
for (const [text, units, json] of rows) {
  const holder: BoundsText = { text }, keys = units.map((unit, index) => String(index));
  assert.compareArray(keys, units.map((unit, index) => String(index))); same(JSON.stringify(holder), '{"text":' + json + '}');
  const positions: [number, number][] = [[-Infinity, -1], [-1, -1], [-0, 0], [0.8, 0], [1.8, 1], [text.length, -1], [NaN, 0], [Infinity, -1]];
  for (const [index, slot] of positions) same(read(holder, index), slot >= 0 && slot < units.length ? units[slot] : "");
  for (const index of [0, text.length]) {
    same(keys.includes(String(index)), index < units.length); same(keys.includes(String(index)), index < units.length);
  }
  same(holder.text.length, units.length);
}
