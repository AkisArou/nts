/*---
description: An object implementing the iterator protocol by hand, with next returning typed results, drives for-of.
features: [ts-iteration, ts-interfaces]
---*/
function countTo(limit: number): Iterable<number> {
  return {
    [Symbol.iterator](): Iterator<number> {
      let current = 0;
      return {
        next(): IteratorResult<number> {
          current++;
          return current <= limit ? { value: current, done: false } : { value: undefined, done: true };
        },
      };
    },
  };
}
const seen: number[] = [];
for (const n of countTo(3)) seen.push(n);
assert.compareArray(seen, [1, 2, 3]);
assert.compareArray(Array.from(countTo(2)), [1, 2]);
