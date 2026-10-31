/*---
description: Control for widening-set-generic-reader-instantiations; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-set-generic-reader-instantiations.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function read(set: Set<number | string>): (number | string)[] { return [...set]; }
function check(n: number): void {
  const numbers = new Set<number | string>([n + 1]);
  const strings = new Set<number | string>(["start"]);
  const text = "item:" + String(n);
  numbers.add(n);
  strings.add(text);
  const numberValues = read(numbers);
  const stringValues = read(strings);
  assert.compareArray<unknown>(numberValues, [n + 1, n]);
  assert.compareArray<unknown>(stringValues, ["start", text]);
  assert.compareArray(numberValues.map(value => typeof value), ["number", "number"]);
  assert.compareArray(stringValues.map(value => typeof value), ["string", "string"]);
  assert.sameValue(numbers.size, 2);
  assert.sameValue(strings.size, 2);
  assert.sameValue(numbers.has(n), true);
  assert.sameValue(strings.has(text), true);
}
for (const n of [-3, 2, 7]) check(n);
