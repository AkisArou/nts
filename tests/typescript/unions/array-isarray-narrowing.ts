/*---
description: Array.isArray narrows a value to its array member.
features: [ts-unions, ts-narrowing]
---*/
function flatten(value: number | number[]): number[] {
  return Array.isArray(value) ? value : [value];
}
assert.compareArray(flatten(3), [3]);
assert.compareArray(flatten([1, 2]), [1, 2]);
const nested: (number | number[])[] = [1, [2, 3], 4];
assert.compareArray(nested.flatMap(flatten), [1, 2, 3, 4]);
