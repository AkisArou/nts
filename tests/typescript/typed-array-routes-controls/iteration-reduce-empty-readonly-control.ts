/*---
description: "Reduce on an empty array throws without an initial value and otherwise returns it without a callback. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-errors, ts-arrow-functions, ts-function-types]
---*/

function localInt8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localUint16Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localFloat64Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localReduce(data: number[], callback: (total: number, value: number, index: number, self: number[]) => number, initial?: number): number {
  if (data.length === 0 && initial === undefined) throw new TypeError("empty"); let total = initial === undefined ? data[0] : initial;
  for (let i = initial === undefined ? 1 : 0; i < data.length; i++) total = callback(total, data[i], i, data); return total;
}
// Reduce on an empty array throws without an initial value and otherwise returns it without a callback. Route: a readonly array of typed reduction operations.
// Node prints iteration-reduce-empty-readonly:ok.
type ReduceEmpty = (callback: (sum: number, value: number) => number, initial?: number) => number;
const operations: readonly ReduceEmpty[] = [
  (callback, initial) => initial === undefined ? localReduce(localInt8Array([]), callback) : localReduce(localInt8Array([]), callback, initial),
  (callback, initial) => initial === undefined ? localReduce(localUint16Array([]), callback) : localReduce(localUint16Array([]), callback, initial),
  (callback, initial) => initial === undefined ? localReduce(localFloat64Array([]), callback) : localReduce(localFloat64Array([]), callback, initial)
];
for (const reduce of operations) {
  let calls = 0; const callback = (sum: number, value: number): number => { calls++; return sum + value; };
  assert.throws(TypeError, () => reduce(callback));
  assert.sameValue(reduce(callback, 17), 17); assert.sameValue(calls, 0);
}
console.log("iteration-reduce-empty-readonly:ok");
