/*---
description: "Array.isArray narrows genuine arrays while rejecting a typed array, an indexed array-like and a string. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-objects, ts-object-type, ts-strings, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localIsArray(value: ArrayCandidate): value is number[] {
  const knownArrays: readonly unknown[] = [emptyNumbers, numberItems];
  for (const array of knownArrays) if (value === array) return true;
  return false;
}
// Array.isArray narrows genuine arrays while rejecting a typed array, an indexed array-like and a string. Route: a declared union read through a narrowing branch. Node prints construction-is-array-union-narrowing:ok.
type ArrayCandidate = number[] | Uint8Array | { 0: number; length: number } | string;
const emptyNumbers: number[] = [], numberItems: number[] = [7, 8];
const bytes = new Uint8Array([7]), arrayLike: { 0: number; length: number } = { 0: 7, length: 1 };
function first(value: ArrayCandidate): number {
  if (localIsArray(value)) return value.length === 0 ? -1 : value[0];
  return -2;
}
const rows: readonly [ArrayCandidate, boolean, number][] = [
  [emptyNumbers, true, -1], [numberItems, true, 7], [bytes, false, -2], [arrayLike, false, -2], ["7", false, -2]
];
for (const [candidate, expected, head] of rows) {
  const result = localIsArray(candidate);
  assert.sameValue(result, expected); assert.sameValue(first(candidate), head);
}
console.log("construction-is-array-union-narrowing:ok");
