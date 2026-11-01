/*---
description: Control for comparator-bound-method-state; a bound class comparator retains its receiver direction for stable key ordering.
features: [ts-sort-route-comparators, ts-arrays, ts-numbers, ts-objects, ts-interfaces, ts-iteration, ts-arrow-functions, ts-function-types, ts-strings, ts-class, ts-class-fields, ts-functions, ts-this]
---*/
// Control: stable insertion over a copy keeps the same typed comparison. Keyed records use a method bound to a typed stateful instance; node respects its direction and preserves every tie.
interface SortItem { key: number; id: string; position: number; }
class KeyOrder {
  direction: number;
  constructor(direction: number) { this.direction = direction; }
  compare(a: SortItem, b: SortItem): number { return this.direction * (a.key - b.key); }
}
const inputs: number[][] = [];
// Shapes are ordered, reversed, equal-key and interleaved duplicates at every length.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: number[] = [];
  for (let i = 0; i < length; i++) input.push(shape === 0 ? Math.floor(i * 3 / length) : shape === 1 ? 2 - Math.floor(i * 3 / length) : shape === 2 ? 1 : (i * 7 + length) % 3);
  inputs.push(input);
}
for (const direction of [1, -1]) {
  const owner = new KeyOrder(direction);
  const compare = owner.compare.bind(owner);
  for (const sample of inputs) {
    const original: SortItem[] = sample.map((key, position) => ({ key, id: "row-" + position, position }));
    const values: SortItem[] = original.slice(), order: number[] = [];
    for (const key of direction === 1 ? [0, 1, 2] : [2, 1, 0]) for (let i = 0; i < sample.length; i++) if (sample[i] === key) order.push(i);
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
  }
}
