/*---
description: BigInt64Array default toSorted through a typed map uses numeric order, and leaves its source unchanged.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-map-set, ts-strings, ts-bigint]
---*/
// BigInt64Array crosses a typed map; node uses numeric order, and leaves its source unchanged.
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
  const result = view.toSorted();
  assert.sameValue(result === view, false);
  assert.compareArray(Array.from(result), expected);
  assert.sameValue(result.buffer === view.buffer, false);
  assert.compareArray(Array.from(view), sample);
}
