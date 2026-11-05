/*---
description: "Reduce without an initial value returns the only element exactly and never calls its callback. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-arrow-functions]
---*/

function localFloat64Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localReduce(data: number[], callback: (total: number, value: number, index: number, self: number[]) => number, initial?: number): number {
  if (data.length === 0 && initial === undefined) throw new TypeError("empty"); let total = initial === undefined ? data[0] : initial;
  for (let i = initial === undefined ? 1 : 0; i < data.length; i++) total = callback(total, data[i], i, data); return total;
}
// Reduce without an initial value returns the only element exactly and never calls its callback. Route: a declared floating array field.
// Node prints iteration-reduce-singleton-field:ok.
type Values = number[];
class SingleSample { data: Values; constructor(value: number) { this.data = localFloat64Array([value]); } }
for (const value of [-0, NaN, Infinity, 5]) {
  const holder = new SingleSample(value); let calls = 0;
  const result = localReduce(holder.data, (sum, item) => { calls++; return sum + item; });
  assert.sameValue(result, value); assert.sameValue(calls, 0);
}
console.log("iteration-reduce-singleton-field:ok");
