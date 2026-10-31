/*---
description: A Set array-from snapshot keeps mixed types and order after its source changes.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-unsound-bivariance]
---*/
// Write a union alias, copy the narrow set; node preserves a separate ordered snapshot including zero, NaN and undefined.
function check(n: number): void {
  const set = new Set<number>([n, NaN, -0]);
  const writer: Set<number | string | undefined> = set;
  writer.add("value:" + n); writer.add(undefined);
  const copy = Array.from(set);
  writer.delete(n); writer.add("changed:" + n);
  const values: unknown[] = [], types: string[] = [];
  for (const value of copy) { values.push(value); types.push(typeof value); }
  assert.compareArray(values, [n, NaN, 0, "value:" + n, undefined]);
  assert.compareArray(types, ["number", "number", "number", "string", "undefined"]);
  assert.sameValue(copy.length, 5);
  assert.sameValue(set.size, 5);
  assert.sameValue(set.has(n), false); assert.sameValue(writer.has(undefined), true);
}
for (const n of [2, 9, 40]) check(n);
