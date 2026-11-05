/*---
description: "Array.from makes an independent dense array while preserving signed zero and shallow element identities. (control)"
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-objects]
---*/

function localFrom<T>(source: Iterable<T>): T[] {
  const result: T[] = [];
  for (const value of source) result[result.length] = value;
  return result;
}
// Array.from makes an independent dense array while preserving signed zero and shallow element identities. Route: a constrained helper at number and record type arguments. Node prints construction-from-array-generic:ok.
function inspect<T extends number | { id: number }>(first: T, second: T): void {
  const source: T[] = [first, second, first, second], result = localFrom(source);
  assert.sameValue(result === source, false); assert.compareArray(result, [first, second, first, second]);
  assert.sameValue(Object.is(result[0], first), true); assert.sameValue(result[2] === first, true);
  source[0] = second;
  assert.compareArray(result, [first, second, first, second]);
  result[1] = first;
  assert.compareArray(source, [second, second, first, second]);
  const empty: T[] = [], copiedEmpty = localFrom(empty);
  assert.compareArray(copiedEmpty, []); assert.sameValue(copiedEmpty === empty, false);
}
inspect<number>(-0, NaN);
const first = { id: 1 }, second = { id: 2 };
inspect<{ id: number }>(first, second);
console.log("construction-from-array-generic:ok");
