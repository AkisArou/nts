/*---
description: "An iterable-input constructor consumes values in iteration order before creating its element storage."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-numbers, ts-generics, ts-generic-constraints, ts-generators, ts-map-set]
---*/

// An iterable-input constructor consumes values in iteration order before creating its element storage. Route: a constrained helper called at Set and generator iterator types.
// Node prints construction-input-iterable-generic:ok.
function* inputValues(): IterableIterator<number> { yield 7; yield -1; yield 7; yield 2; }
function inspect<T extends Iterable<number>>(input: T, expected: readonly number[]): void {
  const result = new Int16Array(input), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.length, expected.length);
}
inspect<Set<number>>(new Set([3, 3, -1]), [3, -1]);
inspect<IterableIterator<number>>(inputValues(), [7, -1, 7, 2]);
console.log("construction-input-iterable-generic:ok");
