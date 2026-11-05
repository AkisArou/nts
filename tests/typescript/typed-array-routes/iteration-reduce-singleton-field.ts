/*---
description: "Reduce without an initial value returns the only element exactly and never calls its callback."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-arrow-functions]
---*/

// Reduce without an initial value returns the only element exactly and never calls its callback. Route: a declared floating array field.
// Node prints iteration-reduce-singleton-field:ok.
type Values = Float64Array;
class SingleSample { data: Values; constructor(value: number) { this.data = new Float64Array([value]); } }
for (const value of [-0, NaN, Infinity, 5]) {
  const holder = new SingleSample(value); let calls = 0;
  const result = holder.data.reduce((sum, item) => { calls++; return sum + item; });
  assert.sameValue(result, value); assert.sameValue(calls, 0);
}
console.log("iteration-reduce-singleton-field:ok");
