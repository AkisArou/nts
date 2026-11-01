/*---
description: Stable insertion sort over a copy controls BigInt64Array default toSorted through a typed map.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-map-set, ts-strings, ts-bigint]
---*/
// BigInt64Array crosses a typed map; node uses numeric order, and leaves its source unchanged.
// Control: stable insertion sort on a copy, then copy back only for sort.
function compare(a: bigint, b: bigint): number { return a < b ? -1 : a > b ? 1 : 0; }
const seeds: bigint[] = [-9223372036854775808n, -10n, 0n, 10n, 9223372036854775807n, 9007199254740993n, 2n, -2n, -9007199254740993n];
const inputs: bigint[][] = [
  [], [2n], [-9223372036854775808n, -9007199254740993n, -10n, -2n, 0n, 2n, 10n, 9007199254740993n, 9223372036854775807n],
  [9223372036854775807n, 9007199254740993n, 10n, 2n, 0n, -2n, -10n, -9007199254740993n, -9223372036854775808n], [2n, 2n, 2n, 2n],
  [-9223372036854775808n, 10n, -9223372036854775808n, -10n, 10n, -10n, -9223372036854775808n, 10n, 0n, -10n, 0n, -9223372036854775808n]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: bigint[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const order: bigint[] = [-9223372036854775808n, -9007199254740993n, -10n, -2n, 0n, 2n, 10n, 9007199254740993n, 9223372036854775807n];
  const expected: bigint[] = [];
  for (const value of order) for (const item of sample) if (Object.is(item, value)) expected.push(item);
  const storage = new Map<string, BigInt64Array>();
  storage.set("values", new BigInt64Array(sample));
  const view = storage.get("values");
  if (view === undefined) throw new Error("missing values");
  const copy = Array.from(view);
  for (let i = 1; i < copy.length; i++) {
    const value = copy[i]; let j = i;
    while (j > 0 && compare(copy[j - 1], value) > 0) { copy[j] = copy[j - 1]; j--; }
    copy[j] = value;
  }
  const result: BigInt64Array = new BigInt64Array(copy);
  assert.sameValue(result === view, false);
  assert.compareArray(Array.from(result), expected);
  assert.sameValue(result.buffer === view.buffer, false);
  assert.compareArray(Array.from(view), sample);
}
