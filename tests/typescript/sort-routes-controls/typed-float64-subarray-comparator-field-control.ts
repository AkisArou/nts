/*---
description: Stable insertion sort over a copy controls Float64Array comparator sort through a class-held subarray.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-function-types, ts-class, ts-class-fields, ts-spread]
---*/
// Float64Array crosses a class-held subarray; node preserves the original order of distinct equal-key values with both zero signs and NaN checked, changing only the visible window in its whole array.
// Control: stable insertion sort on a copy, then copy back only for sort.
function key(value: number): number { return Number.isNaN(value) ? 3 : value < 0 ? 0 : value === 0 ? 1 : 2; }
function compare(a: number, b: number): number { const x = key(a), y = key(b); return x === y ? NaN : x < y ? -Infinity : Infinity; }
class WindowStore { whole: Float64Array; part: Float64Array;
  constructor(values: number[]) { this.whole = new Float64Array([901, 902, ...values, 903, 904]); this.part = this.whole.subarray(2, this.whole.length - 2); }
}
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
  const holder = new WindowStore(sample); const view: Float64Array = holder.part, whole = holder.whole;
  const copy = Array.from(view);
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  view.set(copy);
  const result = view;
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
  assert.sameValue(view.buffer, whole.buffer);
  assert.sameValue(view.byteOffset, 16);
  assert.compareArray(Array.from(whole), [901, 902, ...expected, 903, 904]);
}
