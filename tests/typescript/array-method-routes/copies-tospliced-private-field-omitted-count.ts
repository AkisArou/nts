/*---
description: "ToSpliced with an omitted count removes through the end without changing the original mixed array through a private array field."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

// ToSpliced with an omitted count removes through the end without changing the original mixed array; route: a private array field.
// Node prints copies-tospliced-private-field-omitted-count:ok.
type Item = number | string | { id: number } | null | undefined;
const marker: { id: number } = { id: 7 };
class SpliceBox {
  #items: Item[] = [-0, marker, null, undefined, "tail"];
  copy(start: number): Item[] { return this.#items.toSpliced(start); }
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
