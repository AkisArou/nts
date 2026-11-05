/*---
description: "findLast searches from the end and stops at the final match, returning undefined when none exists."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-unions, ts-null-undefined, ts-destructuring, ts-arrow-functions]
---*/

// findLast searches from the end and stops at the final match, returning undefined when none exists. Route: a private readonly-array field. Node prints reads-find-last-private-field:ok.
class LastMatch {
  #items: readonly number[]; constructor(items: readonly number[]) { this.#items = items; }
  read(limit: number, seen: number[]): number | undefined {
    return this.#items.findLast(value => { seen[seen.length] = value; return value > limit; });
  }
}
const main = new LastMatch([5, 12, 8, 130, 44]), empty = new LastMatch([]), one = new LastMatch([12]);
const rows: readonly [LastMatch, number, number | undefined, readonly number[]][] = [
  [main, 10, 44, [44]], [main, 100, 130, [44, 130]], [main, 200, undefined, [44, 130, 8, 12, 5]],
  [empty, 10, undefined, []], [one, 10, 12, [12]], [one, 20, undefined, [12]]
];
for (const [reader, limit, expected, visits] of rows) {
  const seen: number[] = [], found = reader.read(limit, seen);
  assert.sameValue(found, expected); assert.compareArray(seen, visits);
}
console.log("reads-find-last-private-field:ok");
