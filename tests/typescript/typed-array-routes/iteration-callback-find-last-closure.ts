/*---
description: "FindLast and findLastIndex pass exact reverse callback arguments from the current captured bigint receiver."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-strings]
---*/

// FindLast and findLastIndex pass exact reverse callback arguments from the current captured bigint receiver. Route: typed closures over a replaced bigint array binding. Node prints iteration-callback-find-last-closure:ok.
type Samples = BigInt64Array;
let data: Samples = new BigInt64Array([]), phase = "value";
const log: (string | number | bigint | boolean)[] = [];
const callback = (value: bigint, index: number, owner: Samples): boolean => { log.push(phase, value, index, owner === data); return value < 0n; };
const readValue = (): bigint | undefined => data.findLast(callback);
const readIndex = (): number => data.findLastIndex(callback);
const rows: readonly [readonly bigint[], bigint | undefined, number, readonly (string | number | bigint | boolean)[]][] = [
  [[1n, -1n, 3n, -9n], -9n, 3, ["value", -9n, 3, true, "index", -9n, 3, true]],
  [[-5n, 2n, 7n], -5n, 0, ["value", 7n, 2, true, "value", 2n, 1, true, "value", -5n, 0, true, "index", 7n, 2, true, "index", 2n, 1, true, "index", -5n, 0, true]],
  [[2n, 4n], undefined, -1, ["value", 4n, 1, true, "value", 2n, 0, true, "index", 4n, 1, true, "index", 2n, 0, true]],
  [[], undefined, -1, []]
];
for (const [input, expectedValue, expectedIndex, expectedLog] of rows) {
  data = new BigInt64Array(input); log.length = 0; phase = "value";
  assert.sameValue(readValue(), expectedValue); phase = "index";
  assert.sameValue(readIndex(), expectedIndex); assert.compareArray(log, expectedLog);
}
console.log("iteration-callback-find-last-closure:ok");
