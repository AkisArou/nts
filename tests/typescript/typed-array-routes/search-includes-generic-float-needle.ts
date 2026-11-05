/*---
description: "Includes does not round a double-precision needle before comparing it with a single-precision element."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-generics, ts-generic-constraints, ts-unions]
---*/

// Includes does not round a double-precision needle before comparing it with a single-precision element. Route: a constrained helper called at Float32 and Float64 array type arguments. Node prints search-includes-generic-float-needle:ok.
type SingleSamples = Float32Array;
type DoubleSamples = Float64Array;
const needles: readonly number[] = [0.1, 0.10000000149011612, 16777217, 16777216, 0];
function inspect<T extends SingleSamples | DoubleSamples>(data: T, expected: readonly boolean[]): void {
  for (let i = 0; i < needles.length; i++) assert.sameValue(data.includes(needles[i]), expected[i]);
}
inspect<SingleSamples>(new Float32Array([0.10000000149011612, 16777216, -0]), [false, true, false, true, true]);
inspect<DoubleSamples>(new Float64Array([0.1, 16777217, -0]), [true, false, true, false, true]);
console.log("search-includes-generic-float-needle:ok");
