/*---
description: Stable insertion sort over a copy controls Float64Array comparator toSorted through a typed comparator field.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-function-types, ts-interfaces, ts-objects, ts-arrow-functions]
---*/
// Float64Array crosses a typed comparator field; node preserves the original order of distinct equal-key values with both zero signs and NaN checked, and leaves its source unchanged.
// Control: stable insertion sort on a copy, then copy back only for sort.
function key(value: number): number { return Number.isNaN(value) ? 3 : value < 0 ? 0 : value === 0 ? 1 : 2; }
interface ComparatorHolder { compare: (a: number, b: number) => number; }
const holder: ComparatorHolder = { compare: (a, b) => { const x = key(a), y = key(b); return x === y ? NaN : x < y ? -Infinity : Infinity; } };
const compare: (a: number, b: number) => number = holder.compare;
const seeds: number[] = [-Infinity, -1.5, 0, 2, Infinity, NaN, 10, 1.5, -0, -2];
const inputs: number[][] = [
  [], [2], [-Infinity, -2, -1.5, -0, 0, 1.5, 2, 10, Infinity, NaN],
  [NaN, Infinity, 10, 2, 1.5, 0, -0, -1.5, -2, -Infinity], [2, 2, 2, 2],
  [-Infinity, 2, -Infinity, -1.5, 2, -1.5, -Infinity, 2, 0, -1.5, 0, -Infinity]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const buckets: number[][] = [[-Infinity, -2, -1.5], [-0, 0], [1.5, 2, 10, Infinity], [NaN]];
  const expected: number[] = [];
  for (const bucket of buckets) for (const item of sample) {
    for (const value of bucket) if (Object.is(item, value)) { expected.push(item); break; }
  }
  const view: Float64Array = new Float64Array(sample);
  const copy = Array.from(view);
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  const result: Float64Array = new Float64Array(copy);
  assert.sameValue(result === view, false);
  assert.compareArray(Array.from(result), expected);
  assert.sameValue(result.buffer === view.buffer, false);
  assert.compareArray(Array.from(view), sample);
}
