/*---
description: "Push appends all supplied elements and returns the new length even for zero arguments and empty arrays through a declared public array field."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-null-undefined, ts-spread]
---*/

// Push appends all supplied elements and returns the new length even for zero arguments and empty arrays; route: a declared public array field.
// Node prints writes-push-public-field-length:ok.
type Item = number | string | null | undefined;
class PushBox {
  items: Item[];
  constructor(items: Item[]) { this.items = items; }
  append(values: readonly Item[]): number { return this.items.push(...values); }
}
const rows: readonly [Item[], Item[], number, readonly Item[]][] = [
  [[], [], 0, []], [[], [-0, NaN, null, undefined], 4, [-0, NaN, null, undefined]],
  [["a"], ["b", "c"], 3, ["a", "b", "c"]], [[1, 3], [], 2, [1, 3]]
];
for (const [input, added, expectedLength, expected] of rows) {
  const box: PushBox = new PushBox(input);
  const length = box.append(added);
  assert.sameValue(length, expectedLength);
  assert.sameValue(box.items === input, true);
  assert.compareArray(box.items, expected);
  assert.sameValue(box.items.length, expectedLength);
}
console.log("writes-push-public-field-length:ok");
