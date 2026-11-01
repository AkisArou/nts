/*---
description: Stable insertion sort over a copy controls Int32Array comparator sort through a typed comparator parameter.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-function-types]
---*/
// Int32Array crosses a typed comparator parameter; node preserves the original order of distinct equal-key values.
// Control: stable insertion sort on a copy, then copy back only for sort.
function key(value: number): number { return Math.abs(value) % 3; }
function compare(a: number, b: number): number { const x = key(a), y = key(b); return x === y ? 0 : x < y ? -Infinity : Infinity; }
function ordered(view: Int32Array, comparator: (a: number, b: number) => number): Int32Array {
  const copy = Array.from(view);
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && comparator(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  view.set(copy);
  const result = view;
  return result;
}
const seeds: number[] = [-6, 0, 1, -8, 5, 2, 7, -4, 3];
const inputs: number[][] = [
  [], [2], [-6, 3, 0, -4, 1, 7, -8, 2, 5],
  [5, 2, -8, 7, 1, -4, 0, 3, -6], [2, 2, 2, 2],
  [-6, -8, -6, 0, -8, 0, -6, -8, 1, 0, 1, -6]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const buckets: number[][] = [[-6, 3, 0], [-4, 1, 7], [-8, 2, 5]];
  const expected: number[] = [];
  for (const bucket of buckets) for (const item of sample) {
    for (const value of bucket) if (Object.is(item, value)) { expected.push(item); break; }
  }
  const view: Int32Array = new Int32Array(sample);
  const result = ordered(view, compare);
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
}
