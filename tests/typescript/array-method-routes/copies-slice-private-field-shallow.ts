/*---
description: "Slice without arguments preserves object identities in a fresh top-level array for empty single and longer sources through a private array field."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-objects, ts-type-aliases, ts-numbers]
---*/

// Slice without arguments preserves object identities in a fresh top-level array for empty single and longer sources; route: a private array field.
// Node prints copies-slice-private-field-shallow:ok.
type Token = { id: number };
const first: Token = { id: 1 }, second: Token = { id: 2 }, third: Token = { id: 3 };
class SliceBox {
  #items: Token[];
  constructor(items: Token[]) { this.#items = items; }
  copy(): Token[] { return this.#items.slice(); }
  read(): readonly Token[] { return this.#items; }
}
const rows: Token[][] = [[], [first], [first, second, third]];
for (const values of rows) {
  const box: SliceBox = new SliceBox(values), before: Token[] = [];
  for (const value of values) before[before.length] = value;
  const result = box.copy();
  assert.compareArray(result, before);
  assert.sameValue(result === box.read(), false);
  assert.compareArray(box.read(), before);
  if (result.length > 0) result[0] = third;
  assert.compareArray(box.read(), before);
}
console.log("copies-slice-private-field-shallow:ok");
