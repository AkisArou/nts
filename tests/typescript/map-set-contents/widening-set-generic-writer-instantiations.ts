/*---
description: A generic Set writer preserves independent number and string instantiations.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Write/read route: the same generic writer is instantiated for numeric and string contents; node keeps the exact contents and order.
function write<V>(set: Set<V>, value: V): void { set.add(value); }
function check(n: number): void {
  const numbers = new Set<number>([n + 1]);
  const strings = new Set<string>(["start"]);
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
