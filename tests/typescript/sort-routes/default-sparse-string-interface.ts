/*---
description: Default sorts through an interface string-array field order undefined before holes and densify copying results.
features: [ts-sort-route-default, ts-arrays, ts-strings, ts-numbers, ts-iteration, ts-functions, ts-unions, ts-type-aliases, ts-null-undefined, ts-interfaces, ts-objects, ts-expressions]
---*/
// Sparse strings cross an interface field; node orders UTF-16 text then undefined then holes, while toSorted turns holes into undefined.
type SortValue = string | undefined;
interface StringHolder { values: SortValue[]; }
const palette: SortValue[] = ["", "10", "9", "A", "a", "\uD800", "\uD800\uDC00", "\uDFFF", "\uE000", undefined];
const inputs: SortValue[][] = [];
// Ordered, reversed, equal-key and duplicate-heavy inputs straddle each size boundary.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: SortValue[] = new Array<SortValue>(length), buckets = palette.length + 1;
  for (let i = 0; i < length; i++) {
    const bucket = shape === 0 ? Math.floor(i * buckets / length) : shape === 1 ? buckets - 1 - Math.floor(i * buckets / length) : shape === 2 ? 9 : (i * 7 + length) % buckets;
    if (bucket < palette.length) input[i] = palette[bucket];
  }
  inputs.push(input);
}
for (const sample of inputs) {
  const holder: StringHolder = { values: sample.slice() }, values = holder.values;
  const expected: SortValue[] = [];
  for (const key of ["", "10", "9", "A", "a", "\uD800", "\uD800\uDC00", "\uDFFF", "\uE000"]) for (let i = 0; i < sample.length; i++) if (i in sample && sample[i] !== undefined && String(sample[i]) === key) expected.push(sample[i]);
  for (let i = 0; i < sample.length; i++) if (i in sample && sample[i] === undefined) expected.push(undefined);
  const present = expected.length; expected.length = sample.length;
  const copied = holder.values.toSorted();
  assert.sameValue(copied === values, false); assert.compareArray(copied, expected);
  assert.compareArray(values, sample);
  for (let i = 0; i < values.length; i++) { assert.sameValue(i in values, i in sample); assert.sameValue(i in copied, true); }
  const result = holder.values.sort();
  assert.sameValue(result, values); assert.compareArray(result, expected);
  for (let i = 0; i < result.length; i++) assert.sameValue(i in result, i < present);
}
