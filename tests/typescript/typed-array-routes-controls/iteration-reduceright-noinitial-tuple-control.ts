/*---
description: "ReduceRight without an initial value starts with the last bigint and skips its callback position. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-tuples, ts-unions, ts-narrowing, ts-arrow-functions]
---*/

function localBigInt64Array(values: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localBigUint64Array(values: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localReduceRight(data: bigint[], callback: (sum: bigint, value: bigint, index: number, self: bigint[]) => bigint): bigint { if (data.length === 0) throw new TypeError("empty"); let sum = data[data.length - 1]; for (let i = data.length - 2; i >= 0; i--) sum = callback(sum, data[i], i, data); return sum; }
// ReduceRight without an initial value starts with the last bigint and skips its callback position. Route: readonly tuples with a narrowed discriminant.
// Node prints iteration-reduceright-noinitial-tuple:ok.
type Values = { kind: "signed"; data: bigint[] } | { kind: "unsigned"; data: bigint[] };
const rows: readonly [Values, bigint, readonly (bigint | number | boolean)[]][] = [
  [{ kind: "signed", data: localBigInt64Array([-1n, 2n, 3n]) }, 4n, [3n, 2n, 1, true, 5n, -1n, 0, true]],
  [{ kind: "unsigned", data: localBigUint64Array([1n, 2n, 3n]) }, 6n, [3n, 2n, 1, true, 5n, 1n, 0, true]]
];
for (const [source, expected, expectedLog] of rows) {
  const log: (bigint | number | boolean)[] = [];
  const combine = (sum: bigint, value: bigint, index: number, self: ArrayLike<bigint>): bigint => { log.push(sum, value, index, self === source.data); return sum + value; };
  const result = source.kind === "signed" ? localReduceRight(source.data, combine) : localReduceRight(source.data, combine);
  assert.sameValue(result, expected); assert.compareArray(log, expectedLog);
}
console.log("iteration-reduceright-noinitial-tuple:ok");
