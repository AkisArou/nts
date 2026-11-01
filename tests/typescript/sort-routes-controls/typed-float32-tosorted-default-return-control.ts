/*---
description: Stable insertion sort over a copy controls Float32Array default toSorted through a typed return.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions]
---*/
// Float32Array crosses a typed return; node uses numeric order with both zero signs and NaN checked, and leaves its source unchanged.
// Control: stable insertion sort on a copy, then copy back only for sort.
function acquire(values: number[]): Float32Array { return new Float32Array(values); }
function compare(a: number, b: number): number {
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
  if (Number.isNaN(b)) return -1;
  if (a === 0 && b === 0) return Object.is(a, b) ? 0 : Object.is(a, -0) ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
const seeds: number[] = [-Infinity, -1.5, 0, 2, 10, NaN, Infinity, 9, 1.5, -0, -10];
const inputs: number[][] = [
  [], [2], [-Infinity, -10, -1.5, -0, 0, 1.5, 2, 9, 10, Infinity, NaN],
  [NaN, Infinity, 10, 9, 2, 1.5, 0, -0, -1.5, -10, -Infinity], [2, 2, 2, 2],
  [-Infinity, 2, -Infinity, -1.5, 2, -1.5, -Infinity, 2, 0, -1.5, 0, -Infinity]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const order: number[] = [-Infinity, -10, -1.5, -0, 0, 1.5, 2, 9, 10, Infinity, NaN];
  const expected: number[] = [];
  for (const value of order) for (const item of sample) if (Object.is(item, value)) expected.push(item);
  const view: Float32Array = acquire(sample);
  const copy = Array.from(view);
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  const result: Float32Array = new Float32Array(copy);
  assert.sameValue(result === view, false);
  assert.compareArray(Array.from(result), expected);
  assert.sameValue(result.buffer === view.buffer, false);
  assert.compareArray(Array.from(view), sample);
}
