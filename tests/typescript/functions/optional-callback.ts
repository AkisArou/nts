/*---
description: An optional callback parameter is called through `?.()` only when it was given.
features: [ts-functions, ts-optional-parameters, ts-optional-chaining]
---*/
function sumItems(items: number[], onEach?: (item: number) => void): number {
  let total = 0;
  for (const item of items) {
    total += item;
    onEach?.(item);
  }
  return total;
}
const seen: number[] = [];
assert.sameValue(sumItems([1, 2]), 3);
assert.sameValue(sumItems([3, 4], (n) => seen.push(n)), 7);
assert.compareArray(seen, [3, 4]);
