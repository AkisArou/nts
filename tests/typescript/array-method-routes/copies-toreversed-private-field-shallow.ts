/*---
description: "ToReversed makes an independent reversed array while retaining nested and object identities through a private array field."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-objects, ts-null-undefined]
---*/

// ToReversed makes an independent reversed array while retaining nested and object identities; route: a private array field.
// Node prints copies-toreversed-private-field-shallow:ok.
type Item = number | number[] | { id: number } | null | undefined;
const nested: number[] = [2, 5], marker: { id: number } = { id: 7 };
class ReverseBox {
  #items: Item[];
  constructor(items: Item[]) { this.#items = items; }
  copy(): Item[] { return this.#items.toReversed(); }
  read(): readonly Item[] { return this.#items; }
}
const rows: readonly [Item[], readonly Item[]][] = [[[], []], [[marker], [marker]], [[1, nested, marker, undefined], [undefined, marker, nested, 1]]];
for (const [input, expected] of rows) {
  const box: ReverseBox = new ReverseBox(input), before: Item[] = [];
  for (const value of input) before[before.length] = value;
  const result = box.copy();
  assert.compareArray(result, expected);
  assert.sameValue(result === box.read(), false);
  assert.compareArray(box.read(), before);
  if (result.length > 0) result[0] = null;
  assert.compareArray(box.read(), before);
  assert.compareArray(nested, [2, 5]);
}
console.log("copies-toreversed-private-field-shallow:ok");
