/*---
description: Control for stability-class-getter-key; class instances sorted by a derived getter retain original positions for equal getter keys.
features: [ts-sort-route-stability, ts-arrays, ts-numbers, ts-objects, ts-iteration, ts-arrow-functions, ts-strings, ts-class, ts-class-fields, ts-accessors, ts-functions, ts-this, ts-function-types]
---*/
// Control: stable insertion over a copy keeps the same typed comparison. Instances in a declared class array compare a getter-derived key; node groups that value rather than raw fields and preserves equal-key identities.
class RankedItem {
  rank: number; id: string; position: number;
  constructor(rank: number, position: number) { this.rank = rank; this.id = "row-" + position; this.position = position; }
  get key(): number { return this.rank % 3; }
}
const inputs: number[][] = [];
// Shapes are ordered, reversed, equal-key and interleaved duplicates at every length.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: number[] = [];
  for (let i = 0; i < length; i++) input.push(shape === 0 ? Math.floor(i * 3 / length) : shape === 1 ? 2 - Math.floor(i * 3 / length) : shape === 2 ? 1 : (i * 7 + length) % 3);
  inputs.push(input);
}
for (const sample of inputs) {
  const original: RankedItem[] = sample.map((key, position) => new RankedItem(key + 3 * (position % 2), position));
  const values: RankedItem[] = original.slice(), order: number[] = [];
  for (const key of [0, 1, 2]) for (let i = 0; i < sample.length; i++) if (sample[i] === key) order.push(i);
  const compare = (a: RankedItem, b: RankedItem): number => a.key - b.key;
  const copy = values.slice();
  for (let i = 1; i < copy.length; i++) {
    const item = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], item) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = item;
  }
  for (let i = 0; i < copy.length; i++) values[i] = copy[i];
  const result = values;
  assert.sameValue(result, values);
  assert.compareArray(result, order.map(index => original[index]));
  assert.compareArray(result.map(item => item.id), order.map(index => "row-" + index));
  assert.compareArray(result.map(item => item.position), order);
  assert.compareArray(result.map(item => item.rank), order.map(index => sample[index] + 3 * (index % 2)));
}
