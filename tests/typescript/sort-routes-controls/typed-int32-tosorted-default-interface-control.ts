/*---
description: Stable insertion sort over a copy controls Int32Array default toSorted through a typed interface.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-interfaces, ts-objects]
---*/
// Int32Array crosses a typed interface; node uses numeric order, and leaves its source unchanged.
// Control: stable insertion sort on a copy, then copy back only for sort.
interface TypedHolder { values: Int32Array; }
function compare(a: number, b: number): number { return a < b ? -1 : a > b ? 1 : 0; }
const seeds: number[] = [-2147483648, -2, 2, 10, 2147483647, 9, 0, -10];
const inputs: number[][] = [
  [], [2], [-2147483648, -10, -2, 0, 2, 9, 10, 2147483647],
  [2147483647, 10, 9, 2, 0, -2, -10, -2147483648], [2, 2, 2, 2],
  [-2147483648, 10, -2147483648, -2, 10, -2, -2147483648, 10, 2, -2, 2, -2147483648]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: number[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const order: number[] = [-2147483648, -10, -2, 0, 2, 9, 10, 2147483647];
  const expected: number[] = [];
  for (const value of order) for (const item of sample) if (Object.is(item, value)) expected.push(item);
  const holder: TypedHolder = { values: new Int32Array(sample) }; const view = holder.values;
  const copy = Array.from(view);
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  const result: Int32Array = new Int32Array(copy);
  assert.sameValue(result === view, false);
  assert.compareArray(Array.from(result), expected);
  assert.sameValue(result.buffer === view.buffer, false);
  assert.compareArray(Array.from(view), sample);
}
