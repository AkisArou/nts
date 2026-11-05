/*---
description: "lastIndexOf normalizes starts for a backward search, clamps large positive starts and rejects starts before the array."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring]
---*/

// lastIndexOf normalizes starts for a backward search, clamps large positive starts and rejects starts before the array. Route: a private number-array field with typed index arguments. Node prints reads-last-index-of-private-offsets:ok.
class LastReader {
  #items: number[] = [1, 2, 1, 2];
  read(value: number, start: number): number { return this.#items.lastIndexOf(value, start); }
}
const reader = new LastReader();
const rows: readonly [number, number, number][] = [
  [2, -2, 1], [2, -4, -1], [2, -10, -1], [2, 0, -1], [2, 1, 1], [2, 1.9, 1], [2, 2.9, 1],
  [2, -1.7, 3], [1, 10, 2], [2, 4, 3], [2, Infinity, 3], [2, -Infinity, -1], [1, NaN, 0], [1, -0.5, 0]
];
for (const [value, start, expected] of rows) assert.sameValue(reader.read(value, start), expected);
console.log("reads-last-index-of-private-offsets:ok");
