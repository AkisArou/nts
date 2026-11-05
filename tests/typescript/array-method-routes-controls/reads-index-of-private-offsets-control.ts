/*---
description: "indexOf counts negative starts from the end, truncates fractions and returns minus one past the forward boundary. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-tuples, ts-readonly, ts-destructuring]
---*/

function localIndexOf<T>(items: readonly T[], value: T, from: number = 0): number {
  if (from === Infinity) return -1;
  const whole = from !== from || from === -Infinity ? 0 : from - from % 1;
  let start = whole < 0 ? items.length + whole : whole;
  if (start < 0) start = 0;
  for (let index = start; index < items.length; index++) if (items[index] === value) return index;
  return -1;
}
// indexOf counts negative starts from the end, truncates fractions and returns minus one past the forward boundary. Route: a private number-array field with typed index arguments. Node prints reads-index-of-private-offsets:ok.
class IndexReader {
  #items: number[] = [1, 2, 1, 2];
  read(value: number, start: number): number { return localIndexOf(this.#items, value, start); }
}
const reader = new IndexReader();
const rows: readonly [number, number, number][] = [
  [2, -2, 3], [2, -4, 1], [2, -10, 1], [2, 0, 1], [2, 1, 1], [2, 1.9, 1], [2, 2.9, 3],
  [2, -1.7, 3], [1, 10, -1], [2, 4, -1], [2, Infinity, -1], [2, -Infinity, 1], [1, NaN, 0], [1, -0.5, 0]
];
for (const [value, start, expected] of rows) assert.sameValue(reader.read(value, start), expected);
console.log("reads-index-of-private-offsets:ok");
