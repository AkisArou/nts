/*---
description: "indexOf counts negative starts from the end, truncates fractions and returns minus one past the forward boundary."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-tuples, ts-readonly, ts-destructuring]
---*/

// indexOf counts negative starts from the end, truncates fractions and returns minus one past the forward boundary. Route: a private number-array field with typed index arguments. Node prints reads-index-of-private-offsets:ok.
class IndexReader {
  #items: number[] = [1, 2, 1, 2];
  read(value: number, start: number): number { return this.#items.indexOf(value, start); }
}
const reader = new IndexReader();
const rows: readonly [number, number, number][] = [
  [2, -2, 3], [2, -4, 1], [2, -10, 1], [2, 0, 1], [2, 1, 1], [2, 1.9, 1], [2, 2.9, 3],
  [2, -1.7, 3], [1, 10, -1], [2, 4, -1], [2, Infinity, -1], [2, -Infinity, 1], [1, NaN, 0], [1, -0.5, 0]
];
for (const [value, start, expected] of rows) assert.sameValue(reader.read(value, start), expected);
console.log("reads-index-of-private-offsets:ok");
