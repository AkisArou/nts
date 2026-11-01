/*---
description: A returned comparator closure preserves fractional signs and stable equal-key order.
features: [ts-sort-route-comparators, ts-arrays, ts-numbers, ts-objects, ts-interfaces, ts-iteration, ts-arrow-functions, ts-function-types, ts-strings, ts-functions, ts-closures]
---*/
// Keyed records use a returned closure with a fractional scale; node respects quarter-sized differences and keeps equal keys stable.
interface SortItem { key: number; id: string; position: number; }
function scaled(scale: number): (a: SortItem, b: SortItem) => number { return (a, b) => (a.key - b.key) * scale; }
const inputs: number[][] = [];
// Shapes are ordered, reversed, equal-key and interleaved duplicates at every length.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: number[] = [];
  for (let i = 0; i < length; i++) input.push(shape === 0 ? Math.floor(i * 3 / length) : shape === 1 ? 2 - Math.floor(i * 3 / length) : shape === 2 ? 1 : (i * 7 + length) % 3);
  inputs.push(input);
}
const compare = scaled(0.25);
for (const sample of inputs) {
  const original: SortItem[] = sample.map((key, position) => ({ key, id: "row-" + position, position }));
  const values: SortItem[] = original.slice(), order: number[] = [];
  for (const key of [0, 1, 2]) for (let i = 0; i < sample.length; i++) if (sample[i] === key) order.push(i);
  const result = values.sort(compare);
  assert.sameValue(result, values);
  assert.compareArray(result, order.map(index => original[index]));
  assert.compareArray(result.map(item => item.id), order.map(index => "row-" + index));
  assert.compareArray(result.map(item => item.position), order);
}
