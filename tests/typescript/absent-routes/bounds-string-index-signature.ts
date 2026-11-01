/*---
description: A string read through a numeric index signature preserves absent code units.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-strings, ts-index-signatures, ts-readonly, ts-arrays, ts-tuples, ts-numbers, ts-objects, ts-arrow-functions]
---*/
// Strings cross an index-signature parameter; node exposes UTF-16 code units and returns undefined for absent numeric properties.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [string, string[], string][] = [
  ["", [], '\"\"'], ["A", ["A"], '\"A\"'],
  ["\uD83D\uDE00Z", ["\uD83D", "\uDE00", "Z"], '\"\uD83D\uDE00Z\"'], ["\uD800", ["\uD800"], '\"\\ud800\"']
];
function read(text: { readonly [index: number]: string; readonly length: number }, index: number): string | undefined { return text[index]; }
for (const [text, units, json] of rows) {
  const boxed = new String(text), keys = Object.keys(boxed), expectedKeys = units.map((unit, index) => String(index));
  assert.compareArray(keys, expectedKeys); same(JSON.stringify(text), json);
  for (const index of [-1, -0, 0.5, 1, text.length, text.length + 3, NaN]) {
    const present = Number.isInteger(index) && index >= 0 && index < units.length;
    same(read(text, index), present ? units[index] : undefined);
    same(index in boxed, present); same(Object.hasOwn(boxed, index), present);
  }
  same(text.length, units.length);
}
