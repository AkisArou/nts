/*---
description: BigInt64Array default sort through a typed return uses numeric order.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-bigint]
---*/
// BigInt64Array crosses a typed return; node uses numeric order.
function acquire(values: bigint[]): BigInt64Array { return new BigInt64Array(values); }
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
  const view: BigInt64Array = acquire(sample);
  const result = view.sort();
  assert.sameValue(result === view, true);
  assert.compareArray(Array.from(result), expected);
}
