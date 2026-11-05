/*---
description: "Concat spreads only the argument array and leaves nested arrays null and undefined as elements through a guarded Map lookup of readonly arrays. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-map-set, ts-readonly, ts-unions, ts-type-aliases, ts-numbers, ts-strings, ts-null-undefined]
---*/

function localConcat<T>(items: readonly T[], value: T, tail: readonly T[]): T[] {
  const result: T[] = [];
  for (const item of items) result[result.length] = item;
  result[result.length] = value;
  for (const item of tail) result[result.length] = item;
  return result;
}
// Concat spreads only the argument array and leaves nested arrays null and undefined as elements; route: a guarded Map lookup of readonly arrays.
// Node prints copies-concat-map-nested-arrays:ok.
type Item = number | number[] | null | undefined;
const first: number[] = [1, 3], second: number[] = [5, 8];
const choices: Map<string, readonly Item[]> = new Map<string, readonly Item[]>([["full", [first, 1]], ["empty", []]]);
const tail: readonly Item[] = [second, null, undefined];
for (const key of ["full", "empty"]) {
  const input = choices.get(key);
  if (input === undefined) throw new Error("missing input");
  const result = localConcat(input, 2, tail);
  assert.compareArray(result, key === "full" ? [first, 1, 2, second, null, undefined] : [2, second, null, undefined]);
  assert.sameValue(result === input, false);
  assert.compareArray(input, key === "full" ? [first, 1] : []);
  assert.compareArray(tail, [second, null, undefined]);
  assert.compareArray(first, [1, 3]);
  assert.compareArray(second, [5, 8]);
}
console.log("copies-concat-map-nested-arrays:ok");
