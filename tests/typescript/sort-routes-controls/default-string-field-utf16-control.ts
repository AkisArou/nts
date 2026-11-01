/*---
description: Control for default-string-field-utf16; default sorts through a string-array field preserve UTF-16 order for case, lone surrogates and surrogate pairs.
features: [ts-sort-route-default, ts-arrays, ts-strings, ts-numbers, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-this]
---*/
// Control: stable insertion over a copy uses String comparison and preserves slot presence. Strings cross a class field; node compares UTF-16 code units, returns the same sort array and a separate toSorted copy.
class StringBox { values: string[]; constructor(values: string[]) { this.values = values; } }
function inserted(values: string[], copying: boolean): string[] {
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
const palette: string[] = ["", "10", "9", "A", "Z", "a", "aZ", "aa", "z", "\uD7FF", "\uD800", "\uD800\uDC00", "\uD83D\uDE00", "\uDFFF", "\uE000"];
const inputs: string[][] = [];
// Ordered, reversed, equal-key and duplicate-heavy inputs straddle each size boundary.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: string[] = new Array<string>(length), buckets = palette.length;
  for (let i = 0; i < length; i++) {
    const bucket = shape === 0 ? Math.floor(i * buckets / length) : shape === 1 ? buckets - 1 - Math.floor(i * buckets / length) : shape === 2 ? 5 : (i * 7 + length) % buckets;
    if (bucket < palette.length) input[i] = palette[bucket];
  }
  inputs.push(input);
}
for (const sample of inputs) {
  const holder = new StringBox(sample.slice()), values: string[] = holder.values;
  const expected: string[] = [];
  for (const key of ["", "10", "9", "A", "Z", "a", "aZ", "aa", "z", "\uD7FF", "\uD800", "\uD800\uDC00", "\uD83D\uDE00", "\uDFFF", "\uE000"]) for (const value of sample) if (String(value) === key) expected.push(value);
  const copied = inserted(holder.values, true);
  assert.sameValue(copied === values, false); assert.compareArray(copied, expected);
  assert.compareArray(values, sample);
  const result = inserted(holder.values, false);
  assert.sameValue(result, values); assert.compareArray(result, expected);
}
