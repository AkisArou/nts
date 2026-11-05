/*---
description: "Reduce on an empty array throws without an initial value and otherwise returns it without a callback."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-errors, ts-arrow-functions, ts-function-types]
---*/

// Reduce on an empty array throws without an initial value and otherwise returns it without a callback. Route: a readonly array of typed reduction operations.
// Node prints iteration-reduce-empty-readonly:ok.
type ReduceEmpty = (callback: (sum: number, value: number) => number, initial?: number) => number;
const operations: readonly ReduceEmpty[] = [
  (callback, initial) => initial === undefined ? new Int8Array([]).reduce(callback) : new Int8Array([]).reduce(callback, initial),
  (callback, initial) => initial === undefined ? new Uint16Array([]).reduce(callback) : new Uint16Array([]).reduce(callback, initial),
  (callback, initial) => initial === undefined ? new Float64Array([]).reduce(callback) : new Float64Array([]).reduce(callback, initial)
];
for (const reduce of operations) {
  let calls = 0; const callback = (sum: number, value: number): number => { calls++; return sum + value; };
  assert.throws(TypeError, () => reduce(callback));
  assert.sameValue(reduce(callback, 17), 17); assert.sameValue(calls, 0);
}
console.log("iteration-reduce-empty-readonly:ok");
