/*---
description: "Push retains supplied numeric and object identities in exact argument order and returns the expanded length through a constrained helper at number and object type arguments."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-type-aliases, ts-numbers, ts-objects]
---*/

// Push retains supplied numeric and object identities in exact argument order and returns the expanded length; route: a constrained helper at number and object type arguments.
// Node prints writes-push-generic-values:ok.
type Token = { id: number };
function check<T extends number | Token>(first: T, other: T): void {
  const input: T[] = [first];
  const result = input.push(other, first);
  assert.sameValue(result, 3);
  assert.compareArray(input, [first, other, first]);
  assert.sameValue(input.length, 3);
  if (Object.is(first, -0)) assert.sameValue(Object.is(input[2], -0), true);
}
check<number>(-0, NaN);
const first: Token = { id: 1 }, other: Token = { id: 8 };
check<Token>(first, other);
console.log("writes-push-generic-values:ok");
