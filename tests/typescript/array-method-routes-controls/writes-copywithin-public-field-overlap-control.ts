/*---
description: "CopyWithin preserves the original overlapping sequence and shared reference elements in both directions through a declared public array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localCopyWithin<T>(items: T[], target: number, start: number, end: number = items.length): T[] {
  const to = localIndex(target, items.length), from = localIndex(start, items.length), last = localIndex(end, items.length), copied: T[] = [];
  for (let i = from; i < last && to + copied.length < items.length; i++) copied[copied.length] = items[i];
  for (let i = 0; i < copied.length; i++) items[to + i] = copied[i];
  return items;
}
// CopyWithin preserves the original overlapping sequence and shared reference elements in both directions; route: a declared public array field.
// Node prints writes-copywithin-public-field-overlap:ok.
type Item = number | string | { id: number } | null | undefined;
const first: { id: number } = { id: 1 }, second: { id: number } = { id: 2 };
class CopyBox {
  items: Item[] = [first, "b", second, null, undefined];
  copy(target: number, start: number, end: number): Item[] { return localCopyWithin(this.items, target, start, end); }
}
const rows: readonly [number, number, number, readonly Item[]][] = [
  [1, 0, 4, [first, first, "b", second, null]],
  [0, 1, 5, ["b", second, null, undefined, undefined]], [2, 0, 3, [first, "b", first, "b", second]]
];
for (const [target, start, end, expected] of rows) {
  const box: CopyBox = new CopyBox(), result = box.copy(target, start, end);
  assert.sameValue(result === box.items, true);
  assert.compareArray(box.items, expected);
  assert.sameValue(box.items.length, 5);
}
console.log("writes-copywithin-public-field-overlap:ok");
