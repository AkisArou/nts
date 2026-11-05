/*---
description: "ToSpliced with an omitted count removes through the end without changing the original mixed array through a private array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localToSpliced<T>(items: readonly T[], start: number, count?: number, ...insert: T[]): T[] {
  const first = localIndex(start, items.length), result: T[] = [];
  let removed = arguments.length < 3 ? items.length - first : count === undefined || count !== count || count < 0 ? 0 : count === Infinity ? items.length : count - count % 1;
  if (removed > items.length - first) removed = items.length - first;
  for (let i = 0; i < first; i++) result[result.length] = items[i];
  for (const value of insert) result[result.length] = value;
  for (let i = first + removed; i < items.length; i++) result[result.length] = items[i];
  return result;
}
// ToSpliced with an omitted count removes through the end without changing the original mixed array; route: a private array field.
// Node prints copies-tospliced-private-field-omitted-count:ok.
type Item = number | string | { id: number } | null | undefined;
const marker: { id: number } = { id: 7 };
class SpliceBox {
  #items: Item[] = [-0, marker, null, undefined, "tail"];
  copy(start: number): Item[] { return localToSpliced(this.#items, start); }
  read(): readonly Item[] { return this.#items; }
}
const box: SpliceBox = new SpliceBox();
const rows: readonly [number, readonly Item[]][] = [[1, [-0]], [-2, [-0, marker, null]], [5, [-0, marker, null, undefined, "tail"]], [-9, []], [1.9, [-0]], [NaN, []]];
for (const [start, expected] of rows) {
  const result = box.copy(start);
  assert.compareArray(result, expected);
  assert.sameValue(result === box.read(), false);
  assert.compareArray(box.read(), [-0, marker, null, undefined, "tail"]);
}
console.log("copies-tospliced-private-field-omitted-count:ok");
