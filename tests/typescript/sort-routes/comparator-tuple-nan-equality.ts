/*---
description: A comparator stored in a tuple returns NaN for ties while preserving stable key order.
features: [ts-sort-route-comparators, ts-arrays, ts-numbers, ts-objects, ts-interfaces, ts-iteration, ts-arrow-functions, ts-function-types, ts-strings, ts-tuples]
---*/
// Keyed records use a comparator from a typed tuple slot; node treats each equal-key NaN result as zero and retains original positions.
interface SortItem { key: number; id: string; position: number; }
const carrier: [string, (a: SortItem, b: SortItem) => number] = ["key", (a, b) => a.key === b.key ? NaN : a.key - b.key];
const inputs: number[][] = [];
// Shapes are ordered, reversed, equal-key and interleaved duplicates at every length.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: number[] = [];
  for (let i = 0; i < length; i++) input.push(shape === 0 ? Math.floor(i * 3 / length) : shape === 1 ? 2 - Math.floor(i * 3 / length) : shape === 2 ? 1 : (i * 7 + length) % 3);
  inputs.push(input);
}
const compare = carrier[1];
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
