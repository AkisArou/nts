/*---
description: "Splice returns a separate removed segment and leaves the exact remaining elements when deleting through a declared public array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-objects]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localSplice<T>(items: T[], start: number, count?: number, ...insert: T[]): T[] {
  const first = localIndex(start, items.length), before: T[] = [], result: T[] = [];
  for (const value of items) before[before.length] = value;
  let removed = arguments.length < 3 ? before.length - first : count === undefined || count !== count || count < 0 ? 0 : count === Infinity ? before.length : count - count % 1;
  if (removed > before.length - first) removed = before.length - first;
  for (let i = first; i < first + removed; i++) result[result.length] = before[i];
  let next = first;
  for (const value of insert) items[next++] = value;
  for (let i = first + removed; i < before.length; i++) items[next++] = before[i];
  items.length = next;
  return result;
}
// Splice returns a separate removed segment and leaves the exact remaining elements when deleting; route: a declared public array field.
// Node prints writes-splice-public-field-delete:ok.
type Item = number | string | { id: number };
const marker: { id: number } = { id: 7 };
class SpliceBox {
  items: Item[];
  constructor(items: Item[]) { this.items = items; }
  remove(start: number, count: number): Item[] { return localSplice(this.items, start, count); }
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
