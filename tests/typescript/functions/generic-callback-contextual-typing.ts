/*---
description: A callback's parameter types come from the call it is passed to.
features: [ts-functions, ts-function-types, ts-generics]
---*/
function mapPairs<T, U>(items: T[], f: (item: T, index: number, all: readonly T[]) => U): U[] {
  return items.map((item, index) => f(item, index, items));
}
const tagged = mapPairs(["a", "b"], (item, index, all) => `${item}${index}/${all.length}`);
assert.compareArray(tagged, ["a0/2", "b1/2"]);
const sums = mapPairs([1, 2, 3], (n, i) => n + i);
assert.compareArray(sums, [1, 3, 5]);
