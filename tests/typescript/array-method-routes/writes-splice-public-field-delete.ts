/*---
description: "Splice returns a separate removed segment and leaves the exact remaining elements when deleting through a declared public array field."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-objects]
---*/

// Splice returns a separate removed segment and leaves the exact remaining elements when deleting; route: a declared public array field.
// Node prints writes-splice-public-field-delete:ok.
type Item = number | string | { id: number };
const marker: { id: number } = { id: 7 };
class SpliceBox {
  items: Item[];
  constructor(items: Item[]) { this.items = items; }
  remove(start: number, count: number): Item[] { return this.items.splice(start, count); }
}
const rows: readonly [Item[], number, number, readonly Item[], readonly Item[]][] = [
  [[], 0, 1, [], []], [[marker], 0, 1, [marker], []],
  [[1, -0, NaN, marker, "tail"], 1, 2, [-0, NaN], [1, marker, "tail"]],
  [[1, 2, 3, 4, 5], 1, 2, [2, 3], [1, 4, 5]], [[1, 2, 3], 1, 9, [2, 3], [1]]
];
for (const [input, start, count, removed, remaining] of rows) {
  const box: SpliceBox = new SpliceBox(input), result = box.remove(start, count);
  assert.compareArray(result, removed);
  assert.compareArray(box.items, remaining);
  assert.sameValue(result === input, false);
  assert.sameValue(box.items === input, true);
}
console.log("writes-splice-public-field-delete:ok");
