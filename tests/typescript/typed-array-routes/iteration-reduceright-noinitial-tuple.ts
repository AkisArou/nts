/*---
description: "ReduceRight without an initial value starts with the last bigint and skips its callback position."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-tuples, ts-unions, ts-narrowing, ts-arrow-functions]
---*/

// ReduceRight without an initial value starts with the last bigint and skips its callback position. Route: readonly tuples with a narrowed discriminant.
// Node prints iteration-reduceright-noinitial-tuple:ok.
type Values = { kind: "signed"; data: BigInt64Array } | { kind: "unsigned"; data: BigUint64Array };
const rows: readonly [Values, bigint, readonly (bigint | number | boolean)[]][] = [
  [{ kind: "signed", data: new BigInt64Array([-1n, 2n, 3n]) }, 4n, [3n, 2n, 1, true, 5n, -1n, 0, true]],
  [{ kind: "unsigned", data: new BigUint64Array([1n, 2n, 3n]) }, 6n, [3n, 2n, 1, true, 5n, 1n, 0, true]]
];
for (const [source, expected, expectedLog] of rows) {
  const log: (bigint | number | boolean)[] = [];
  const combine = (sum: bigint, value: bigint, index: number, self: ArrayLike<bigint>): bigint => { log.push(sum, value, index, self === source.data); return sum + value; };
  const result = source.kind === "signed" ? source.data.reduceRight(combine) : source.data.reduceRight(combine);
  assert.sameValue(result, expected); assert.compareArray(log, expectedLog);
}
console.log("iteration-reduceright-noinitial-tuple:ok");
