/*---
description: Default sorts of a union-array Map value preserve numeric and string values with equal string forms.
features: [ts-sort-route-default, ts-arrays, ts-strings, ts-numbers, ts-iteration, ts-functions, ts-unions, ts-type-aliases, ts-map-set]
---*/
// A string-or-number array crosses a typed Map; node keeps equal string forms stable, sorts 10 before 9 and preserves the copying source.
type SortValue = string | number;
const stores = new Map<string, SortValue[]>();
const palette: SortValue[] = [-0, 0, "0", 1, "1", 10, "10", 2, "2", 9, "9", "A", "a"];
const inputs: SortValue[][] = [];
// Ordered, reversed, equal-key and duplicate-heavy inputs straddle each size boundary.
for (const length of [0, 1, 9, 10, 11, 31, 32, 33, 63, 64, 65]) for (const shape of [0, 1, 2, 3]) {
  const input: SortValue[] = new Array<SortValue>(length), buckets = palette.length;
  for (let i = 0; i < length; i++) {
    const bucket = shape === 0 ? Math.floor(i * buckets / length) : shape === 1 ? buckets - 1 - Math.floor(i * buckets / length) : shape === 2 ? i % 3 : (i * 7 + length) % buckets;
    if (bucket < palette.length) input[i] = palette[bucket];
  }
  inputs.push(input);
}
for (const sample of inputs) {
  stores.set("current", sample.slice());
  const values = stores.get("current");
  if (values === undefined) throw new Error("missing array");
  const expected: SortValue[] = [];
  for (const key of ["0", "1", "10", "2", "9", "A", "a"]) for (const value of sample) if (String(value) === key) expected.push(value);
  const copied = values.toSorted();
  assert.sameValue(copied === values, false); assert.compareArray(copied, expected);
  assert.compareArray(values, sample);
  const result = values.sort();
  assert.sameValue(result, values); assert.compareArray(result, expected);
}
