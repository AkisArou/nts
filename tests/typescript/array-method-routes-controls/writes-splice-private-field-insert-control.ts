/*---
description: "Splice with zero deletion inserts in argument order and returns a fresh empty array through a private array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-numbers, ts-strings, ts-spread]
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
// Splice with zero deletion inserts in argument order and returns a fresh empty array; route: a private array field.
// Node prints writes-splice-private-field-insert:ok.
class InsertBox {
  #items: string[];
  constructor(items: string[]) { this.#items = items; }
  insert(start: number, values: readonly string[]): string[] { return localSplice(this.#items, start, 0, ...values); }
  read(): readonly string[] { return this.#items; }
}
const rows: readonly [string[], number, string[], readonly string[]][] = [
  [[], 0, ["x"], ["x"]], [["a"], 0, ["x", "y"], ["x", "y", "a"]],
  [["a", "c"], 1, ["b"], ["a", "b", "c"]], [["a", "c"], -1, ["x", "y"], ["a", "x", "y", "c"]],
  [["a", "c"], 9, [], ["a", "c"]]
];
for (const [input, start, values, remaining] of rows) {
  const box: InsertBox = new InsertBox(input), result = box.insert(start, values);
  assert.compareArray(result, []);
  assert.compareArray(box.read(), remaining);
  assert.sameValue(result === input, false);
  assert.sameValue(box.read() === input, true);
}
console.log("writes-splice-private-field-insert:ok");
