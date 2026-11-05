/*---
description: "Includes does not round a double-precision needle before comparing it with a single-precision element. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-generics, ts-generic-constraints, ts-unions]
---*/

function localFloat32Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFloat64Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIncludes<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): boolean {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle || items[i] !== items[i] && needle !== needle) return true; return false;
}
// Includes does not round a double-precision needle before comparing it with a single-precision element. Route: a constrained helper called at Float32 and Float64 array type arguments. Node prints search-includes-generic-float-needle:ok.
type SingleSamples = number[];
type DoubleSamples = number[];
const needles: readonly number[] = [0.1, 0.10000000149011612, 16777217, 16777216, 0];
function inspect<T extends SingleSamples | DoubleSamples>(data: T, expected: readonly boolean[]): void {
  for (let i = 0; i < needles.length; i++) assert.sameValue(localIncludes(data, needles[i]), expected[i]);
}
inspect<SingleSamples>(localFloat32Array([0.10000000149011612, 16777216, -0]), [false, true, false, true, true]);
inspect<DoubleSamples>(localFloat64Array([0.1, 16777217, -0]), [true, false, true, false, true]);
console.log("search-includes-generic-float-needle:ok");
