/*---
description: "Pop returns the last value exactly and leaves the expected prefix including empty and undefined-element arrays through a private array field."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

// Pop returns the last value exactly and leaves the expected prefix including empty and undefined-element arrays; route: a private array field.
// Node prints writes-pop-private-field-results:ok.
type Item = number | string | { id: number } | null | undefined;
const marker: { id: number } = { id: 7 };
class PopBox {
  #items: Item[];
  constructor(items: Item[]) { this.#items = items; }
  take(): Item | undefined { return this.#items.pop(); }
  read(): readonly Item[] { return this.#items; }
}
const rows: readonly [Item[], Item | undefined, readonly Item[]][] = [[[], undefined, []], [[undefined], undefined, []], [[-0], -0, []], [[null], null, []], [[marker], marker, []], [[1, NaN, marker, "tail"], "tail", [1, NaN, marker]]];
for (const [input, expected, remaining] of rows) {
  const box: PopBox = new PopBox(input);
  const result = box.take();
  assert.sameValue(result, expected);
  assert.sameValue(Object.is(result, expected), true);
  assert.compareArray(box.read(), remaining);
  assert.sameValue(box.read() === input, true);
}
console.log("writes-pop-private-field-results:ok");
