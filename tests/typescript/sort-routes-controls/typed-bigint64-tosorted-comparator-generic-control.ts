/*---
description: Stable insertion sort over a copy controls BigInt64Array comparator toSorted through a typed comparator generic.
features: [ts-sort-route-typed-arrays, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-bigint, ts-function-types, ts-generics, ts-closures, ts-arrow-functions]
---*/
// BigInt64Array crosses a typed comparator generic; node preserves the original order of distinct equal-key values, and leaves its source unchanged.
// Control: stable insertion sort on a copy, then copy back only for sort.
function key(value: bigint): bigint { return (value < 0n ? -value : value) % 2n; }
function byKey<T>(read: (value: T) => bigint): (a: T, b: T) => number {
  return (a, b) => { const x = read(a), y = read(b); return x === y ? NaN : x < y ? -0.25 : 0.25; };
}
const compare: (a: bigint, b: bigint) => number = byKey(key);
const seeds: bigint[] = [-9223372036854775808n, -2n, 2n, -9007199254740993n, 1n, 9223372036854775807n, 9007199254740993n, -1n, 9007199254740994n, 0n, -9007199254740994n];
const inputs: bigint[][] = [
  [], [2n], [-9223372036854775808n, -9007199254740994n, -2n, 0n, 2n, 9007199254740994n, -9007199254740993n, -1n, 1n, 9007199254740993n, 9223372036854775807n],
  [9223372036854775807n, 9007199254740993n, 1n, -1n, -9007199254740993n, 9007199254740994n, 2n, 0n, -2n, -9007199254740994n, -9223372036854775808n], [2n, 2n, 2n, 2n],
  [-9223372036854775808n, -9007199254740993n, -9223372036854775808n, -2n, -9007199254740993n, -2n, -9223372036854775808n, -9007199254740993n, 2n, -2n, 2n, -9223372036854775808n]
];
for (const length of [9, 10, 11, 31, 32, 33, 63, 64, 65]) {
  const sample: bigint[] = [];
  for (let i = 0; i < length; i++) sample.push(seeds[(i * 7 + length) % seeds.length]);
  inputs.push(sample);
}
for (const sample of inputs) {
  const buckets: bigint[][] = [[-9223372036854775808n, -9007199254740994n, -2n, 0n, 2n, 9007199254740994n], [-9007199254740993n, -1n, 1n, 9007199254740993n, 9223372036854775807n]];
  const expected: bigint[] = [];
  for (const bucket of buckets) for (const item of sample) {
    for (const value of bucket) if (Object.is(item, value)) { expected.push(item); break; }
  }
  const view: BigInt64Array = new BigInt64Array(sample);
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
