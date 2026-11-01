/*---
description: Control for default-number-return-string-order; default sorts through a number-array return compare strings and preserve signed-zero ties.
features: [ts-sort-route-default, ts-arrays, ts-strings, ts-numbers, ts-iteration, ts-functions]
---*/
// Control: stable insertion over a copy uses String comparison and preserves slot presence. Numbers cross a declared array return; node places 10 before 2 before 9, preserves both zero signs and leaves the copying source intact.
function routed(values: number[]): number[] { return values; }
function inserted(values: number[], copying: boolean): number[] {
  const copy = values.slice();
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && String(copy[j - 1]) > String(value)) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  if (copying) return copy;
  for (let i = 0; i < copy.length; i++) values[i] = copy[i];
  return values;
}
const palette: number[] = [-10, -2, -Infinity, -0, 0, 1, 10, 2, 9, Infinity, NaN];
const inputs: number[][] = [];
// Ordered, reversed, equal-key and duplicate-heavy inputs straddle each size boundary.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: number[] = new Array<number>(length), buckets = palette.length;
  for (let i = 0; i < length; i++) {
    const bucket = shape === 0 ? Math.floor(i * buckets / length) : shape === 1 ? buckets - 1 - Math.floor(i * buckets / length) : shape === 2 ? 3 + i % 2 : (i * 7 + length) % buckets;
    if (bucket < palette.length) input[i] = palette[bucket];
  }
  inputs.push(input);
}
for (const sample of inputs) {
  const values: number[] = sample.slice();
  const expected: number[] = [];
  for (const key of ["-10", "-2", "-Infinity", "0", "1", "10", "2", "9", "Infinity", "NaN"]) for (const value of sample) if (String(value) === key) expected.push(value);
  const copied = inserted(routed(values), true);
  assert.sameValue(copied === values, false); assert.compareArray(copied, expected);
  assert.compareArray(values, sample);
  const result = inserted(routed(values), false);
  assert.sameValue(result, values); assert.compareArray(result, expected);
}
