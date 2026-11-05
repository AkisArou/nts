/*---
description: "Some stops at the first true callback and preserves all value, index and receiver arguments. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-arrow-functions, ts-closures, ts-readonly, ts-unions, ts-generics, ts-generic-constraints]
---*/

function localInt16Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFloat64Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localSome(data: number[], callback: (value: number, index: number, owner: number[]) => boolean): boolean { for (let i = 0, length = data.length; i < length; i++) if (callback(data[i], i, data)) return true; return false; }
// Some stops at the first true callback and preserves all value, index and receiver arguments. Route: a constrained helper called at integer and floating array type arguments. Node prints iteration-callback-some-generic:ok.
type WholeSamples = number[];
type RealSamples = number[];
function inspect<T extends WholeSamples | RealSamples>(data: T, limit: number, expected: boolean, expectedLog: readonly (number | boolean)[]): void {
  const log: (number | boolean)[] = [];
  const callback = (value: number, index: number, owner: WholeSamples | RealSamples): boolean => { log.push(value, index, owner === data); return value > limit; };
  assert.sameValue(localSome(data, callback), expected); assert.compareArray(log, expectedLog);
}
inspect<WholeSamples>(localInt16Array([1, 2, 3, 4]), 2, true, [1, 0, true, 2, 1, true, 3, 2, true]);
inspect<RealSamples>(localFloat64Array([-0, 1.5, 4.5]), 2, true, [-0, 0, true, 1.5, 1, true, 4.5, 2, true]);
inspect<WholeSamples>(localInt16Array([1, 2]), 5, false, [1, 0, true, 2, 1, true]);
inspect<RealSamples>(localFloat64Array([]), 0, false, []);
console.log("iteration-callback-some-generic:ok");
