/*---
description: Control for default-sparse-union-tuple; default sorts through a tuple-held union array preserve equal string forms, undefined and holes.
features: [ts-sort-route-default, ts-arrays, ts-strings, ts-numbers, ts-iteration, ts-functions, ts-unions, ts-type-aliases, ts-null-undefined, ts-tuples, ts-expressions]
---*/
// Control: stable insertion over a copy uses String comparison and preserves slot presence. A sparse string-or-number-or-undefined array crosses a tuple slot; node preserves mixed-kind ties and separates undefined from trailing holes.
type SortValue = string | number | undefined;
function inserted(values: SortValue[], copying: boolean): SortValue[] {
  const copy: SortValue[] = copying ? Array.from(values) : [];
  if (!copying) for (let i = 0; i < values.length; i++) if (i in values) copy.push(values[i]);
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && (copy[j - 1] === undefined ? value !== undefined : value !== undefined && String(copy[j - 1]) > String(value))) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  if (copying) return copy;
  for (let i = 0; i < values.length; i++) { if (i < copy.length) values[i] = copy[i]; else delete values[i]; }
  return values;
}
const palette: SortValue[] = [-0, 0, "0", 1, "1", 10, "10", 2, "2", 9, "9", "A", "a", undefined];
const inputs: SortValue[][] = [];
// Ordered, reversed, equal-key and duplicate-heavy inputs straddle each size boundary.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: SortValue[] = new Array<SortValue>(length), buckets = palette.length + 1;
  for (let i = 0; i < length; i++) {
    const bucket = shape === 0 ? Math.floor(i * buckets / length) : shape === 1 ? buckets - 1 - Math.floor(i * buckets / length) : shape === 2 ? 13 : (i * 7 + length) % buckets;
    if (bucket < palette.length) input[i] = palette[bucket];
  }
  inputs.push(input);
}
for (const sample of inputs) {
  const carrier: [string, SortValue[]] = ["values", sample.slice()], values = carrier[1];
  const expected: SortValue[] = [];
  for (const key of ["0", "1", "10", "2", "9", "A", "a"]) for (let i = 0; i < sample.length; i++) if (i in sample && sample[i] !== undefined && String(sample[i]) === key) expected.push(sample[i]);
  for (let i = 0; i < sample.length; i++) if (i in sample && sample[i] === undefined) expected.push(undefined);
  const present = expected.length; expected.length = sample.length;
  const copied = inserted(carrier[1], true);
  assert.sameValue(copied === values, false); assert.compareArray(copied, expected);
  assert.compareArray(values, sample);
  for (let i = 0; i < values.length; i++) { assert.sameValue(i in values, i in sample); assert.sameValue(i in copied, true); }
  const result = inserted(carrier[1], false);
  assert.sameValue(result, values); assert.compareArray(result, expected);
  for (let i = 0; i < result.length; i++) assert.sameValue(i in result, i < present);
}
