/*---
description: "An iterable-input constructor consumes values in iteration order before creating its element storage. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-numbers, ts-generics, ts-generic-constraints, ts-generators, ts-map-set]
---*/

function localInteger(value: number, width: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** width, n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localInt16Array(values: Iterable<number>): number[] { const result: number[] = []; for (const value of values) result[result.length] = localInteger(value, 16, true); return result; }
// An iterable-input constructor consumes values in iteration order before creating its element storage. Route: a constrained helper called at Set and generator iterator types.
// Node prints construction-input-iterable-generic:ok.
function* inputValues(): IterableIterator<number> { yield 7; yield -1; yield 7; yield 2; }
function inspect<T extends Iterable<number>>(input: T, expected: readonly number[]): void {
  const result = localInt16Array(input), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.length, expected.length);
}
inspect<Set<number>>(new Set([3, 3, -1]), [3, -1]);
inspect<IterableIterator<number>>(inputValues(), [7, -1, 7, 2]);
console.log("construction-input-iterable-generic:ok");
