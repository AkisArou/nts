/*---
description: "Splice with zero deletion inserts in argument order and returns a fresh empty array through a private array field."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-numbers, ts-strings, ts-spread]
---*/

// Splice with zero deletion inserts in argument order and returns a fresh empty array; route: a private array field.
// Node prints writes-splice-private-field-insert:ok.
class InsertBox {
  #items: string[];
  constructor(items: string[]) { this.#items = items; }
  insert(start: number, values: readonly string[]): string[] { return this.#items.splice(start, 0, ...values); }
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
