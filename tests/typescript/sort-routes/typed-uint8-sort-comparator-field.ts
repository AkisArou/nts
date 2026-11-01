/*---
description: Uint8Array comparator sort through a typed comparator field preserves the original order of distinct equal-key values.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-function-types, ts-interfaces, ts-objects, ts-arrow-functions]
---*/
// Uint8Array crosses a typed comparator field; node preserves the original order of distinct equal-key values.
function key(value: number): number { return value % 2; }
interface ComparatorHolder { compare: (a: number, b: number) => number; }
const holder: ComparatorHolder = { compare: (a, b) => { const x = key(a), y = key(b); return x === y ? 0 : x < y ? -0.25 : 0.25; } };
const compare: (a: number, b: number) => number = holder.compare;
const seeds: number[] = [0, 10, 1, 9, 255, 3, 254, 2];
const inputs: number[][] = [
  [], [2], [0, 2, 10, 254, 1, 3, 9, 255],
  [255, 9, 3, 1, 254, 10, 2, 0], [2, 2, 2, 2],
  [0, 9, 0, 10, 9, 10, 0, 9, 1, 10, 1, 0]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const buckets: number[][] = [[0, 2, 10, 254], [1, 3, 9, 255]];
  const expected: number[] = [];
  for (const bucket of buckets) for (const item of sample) {
    for (const value of bucket) if (Object.is(item, value)) { expected.push(item); break; }
  }
  const view: Uint8Array = new Uint8Array(sample);
  const result = view.sort(compare);
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
}
