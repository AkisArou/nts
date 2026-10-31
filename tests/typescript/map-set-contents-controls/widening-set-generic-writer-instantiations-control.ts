/*---
description: Control for widening-set-generic-writer-instantiations; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-set-generic-writer-instantiations.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function write(set: Set<number | string>, value: number | string): void { set.add(value); }
function check(n: number): void {
  const numbers = new Set<number | string>([n + 1]);
  const strings = new Set<number | string>(["start"]);
  const text = "item:" + String(n);
  write(numbers, n);
  write(strings, text);
  const numberValues = [...numbers];
  const stringValues = [...strings];
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
