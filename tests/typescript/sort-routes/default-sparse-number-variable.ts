/*---
description: Default sorts on a declared number-or-undefined array preserve lexical values and exact sparse slots.
features: [ts-sort-route-default, ts-arrays, ts-strings, ts-numbers, ts-iteration, ts-functions, ts-unions, ts-type-aliases, ts-null-undefined, ts-expressions]
---*/
// A sparse number-or-undefined variable uses default sorting; node keeps zero ties stable, undefined before holes and a dense separate copy.
type SortValue = number | undefined;
const palette: SortValue[] = [-10, -2, -Infinity, -0, 0, 1, 10, 2, 9, Infinity, NaN, undefined];
const inputs: SortValue[][] = [];
// Ordered, reversed, equal-key and duplicate-heavy inputs straddle each size boundary.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: SortValue[] = new Array<SortValue>(length), buckets = palette.length + 1;
  for (let i = 0; i < length; i++) {
    const bucket = shape === 0 ? Math.floor(i * buckets / length) : shape === 1 ? buckets - 1 - Math.floor(i * buckets / length) : shape === 2 ? 3 + i % 2 : (i * 7 + length) % buckets;
    if (bucket < palette.length) input[i] = palette[bucket];
  }
  inputs.push(input);
}
for (const sample of inputs) {
  const values: SortValue[] = sample.slice();
  const expected: SortValue[] = [];
  for (const key of ["-10", "-2", "-Infinity", "0", "1", "10", "2", "9", "Infinity", "NaN"]) for (let i = 0; i < sample.length; i++) if (i in sample && sample[i] !== undefined && String(sample[i]) === key) expected.push(sample[i]);
  for (let i = 0; i < sample.length; i++) if (i in sample && sample[i] === undefined) expected.push(undefined);
  const present = expected.length; expected.length = sample.length;
  const copied = values.toSorted();
  assert.sameValue(copied === values, false); assert.compareArray(copied, expected);
  assert.compareArray(values, sample);
  for (let i = 0; i < values.length; i++) { assert.sameValue(i in values, i in sample); assert.sameValue(i in copied, true); }
  const result = values.sort();
  assert.sameValue(result, values); assert.compareArray(result, expected);
  for (let i = 0; i < result.length; i++) assert.sameValue(i in result, i < present);
}
