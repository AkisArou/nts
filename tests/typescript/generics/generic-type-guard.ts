/*---
description: A generic type predicate filters out undefined and narrows the array it leaves.
features: [ts-generics, ts-type-guards, ts-narrowing]
---*/
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
const sparse: (number | undefined)[] = [1, undefined, 3, undefined, 5];
const dense: number[] = sparse.filter(isDefined);
assert.compareArray(dense, [1, 3, 5]);
const labels = ["a", undefined, "b"].filter(isDefined).map((s) => s.toUpperCase());
assert.compareArray(labels, ["A", "B"]);
