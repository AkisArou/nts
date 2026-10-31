/*---
description: Control for widening-map-conditional-view; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-spread, ts-numbers, ts-strings]
---*/
// Paired case: ../map-set-contents/widening-map-conditional-view.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function check(n: number, numeric: boolean): void {
  const text = "item:" + String(n);
  const numbers = new Map<string, number | string>([["keep", n]]);
  const strings = new Map<string, number | string>([["keep", text]]);
  const selected: Map<string, number | string> = numeric ? numbers : strings;
  const expected = numeric ? text : n;
  selected.set("added", expected);
  const value = numeric ? numbers.get("added") : strings.get("added");
  assert.sameValue<unknown>(value, expected);
  assert.sameValue(typeof value, typeof expected);
  assert.sameValue(numbers.size, numeric ? 2 : 1);
  assert.sameValue(strings.size, numeric ? 1 : 2);
  assert.sameValue(numbers.has("added"), numeric);
  assert.sameValue(strings.has("added"), !numeric);
  assert.compareArray([...selected.keys()], ["keep", "added"]);
  assert.compareArray<unknown>([...selected.values()], [numeric ? n : text, expected]);
}
for (const n of [-0, NaN, 2147483649]) for (const numeric of [false, true]) check(n, numeric);
