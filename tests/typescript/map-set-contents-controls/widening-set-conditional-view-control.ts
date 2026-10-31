/*---
description: Control for widening-set-conditional-view; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-set-conditional-view.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function check(n: number, numeric: boolean): void {
  const text = "item:" + String(n);
  const numbers = new Set<number | string>([n]);
  const strings = new Set<number | string>([text]);
  const selected: Set<number | string> = numeric ? numbers : strings;
  const expected = numeric ? text : n;
  selected.add(expected);
  const values = numeric ? [...numbers] : [...strings];
  assert.compareArray<unknown>(values, [numeric ? n : text, expected]);
  assert.compareArray(values.map(value => typeof value), numeric ? ["number", "string"] : ["string", "number"]);
  assert.sameValue(numbers.size, numeric ? 2 : 1);
  assert.sameValue(strings.size, numeric ? 1 : 2);
  assert.sameValue(selected.has(expected), true);
}
for (const n of [-3, 2, 7]) for (const numeric of [false, true]) check(n, numeric);
