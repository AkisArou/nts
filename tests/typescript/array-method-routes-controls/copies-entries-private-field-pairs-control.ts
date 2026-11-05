/*---
description: "Entries yields each dense index and its exact corresponding value in order without altering the source through a private readonly array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-objects, ts-null-undefined]
---*/

function* localEntries<T>(items: readonly T[]): Generator<[number, T], void, unknown> {
  for (let i = 0; i < items.length; i++) yield [i, items[i]];
}
// Entries yields each dense index and its exact corresponding value in order without altering the source; route: a private readonly array field.
// Node prints copies-entries-private-field-pairs:ok.
type Item = number | string | { id: number } | undefined;
const marker: { id: number } = { id: 7 };
class EntryBox {
  #items: readonly Item[];
  constructor(items: readonly Item[]) { this.#items = items; }
  enumerate(): Iterable<[number, Item]> { return localEntries(this.#items); }
  read(): readonly Item[] { return this.#items; }
}
const rows: readonly [readonly Item[], readonly number[]][] = [[[], []], [[marker], [0]], [[undefined, -0, marker, "tail"], [0, 1, 2, 3]]];
for (const [input, expectedIndices] of rows) {
  const box: EntryBox = new EntryBox(input), before: Item[] = [], values: Item[] = [], indices: number[] = [];
  for (const value of input) before[before.length] = value;
  for (const pair of box.enumerate()) {
    assert.sameValue(pair.length, 2);
    assert.sameValue(pair[0], values.length);
    indices[indices.length] = pair[0];
    values[values.length] = pair[1];
  }
  assert.compareArray(indices, expectedIndices);
  assert.compareArray(values, before);
  assert.compareArray(box.read(), before);
}
console.log("copies-entries-private-field-pairs:ok");
