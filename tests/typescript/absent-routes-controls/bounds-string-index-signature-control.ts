/*---
description: Control for bounds-string-index-signature; make absence explicit before reading.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-strings, ts-index-signatures, ts-readonly, ts-arrays, ts-tuples, ts-numbers, ts-objects, ts-arrow-functions]
---*/
// An integer and length guard permits only existing code-unit reads; the UTF-16 input table supplies the recorded key list.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [string, string[], string][] = [
  ["", [], '\"\"'], ["A", ["A"], '\"A\"'],
  ["\uD83D\uDE00Z", ["\uD83D", "\uDE00", "Z"], '\"\uD83D\uDE00Z\"'], ["\uD800", ["\uD800"], '\"\\ud800\"']
];
function read(text: { readonly [index: number]: string; readonly length: number }, index: number): string | undefined { return Number.isInteger(index) && index >= 0 && index < text.length ? text[index] : undefined; }
for (const [text, units, json] of rows) {
  const keys = units.map((unit, index) => String(index)), expectedKeys = units.map((unit, index) => String(index));
  assert.compareArray(keys, expectedKeys); same(JSON.stringify(text), json);
  for (const index of [-1, -0, 0.5, 1, text.length, text.length + 3, NaN]) {
    const present = Number.isInteger(index) && index >= 0 && index < units.length;
    same(read(text, index), present ? units[index] : undefined);
    same(keys.includes(String(index)), present); same(keys.includes(String(index)), present);
  }
  same(text.length, units.length);
}
