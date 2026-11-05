/*---
description: "Array.from passes each value and index to a mapper and returns a fresh result without writing its source."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-tuples, ts-destructuring, ts-arrow-functions]
---*/

// Array.from passes each value and index to a mapper and returns a fresh result without writing its source. Route: a private readonly number-array field. Node prints construction-from-array-private-mapper:ok.
class FromReader {
  #items: readonly number[]; constructor(items: readonly number[]) { this.#items = items; }
  copy(): number[] { return Array.from(this.#items, (value, index) => value * 10 + index); }
}
const rows: readonly [readonly number[], readonly number[], readonly number[]][] = [
  [[], [], []], [[7], [70], [7]], [[4, 4, 4], [40, 41, 42], [4, 4, 4]],
  [[3, 1, 8], [30, 11, 82], [3, 1, 8]]
];
for (const [source, expected, unchanged] of rows) {
  const reader = new FromReader(source), result = reader.copy(), repeated = reader.copy();
  assert.compareArray(result, expected); assert.sameValue(result === source, false);
  assert.sameValue(result === repeated, false); assert.compareArray(source, unchanged);
}
console.log("construction-from-array-private-mapper:ok");
