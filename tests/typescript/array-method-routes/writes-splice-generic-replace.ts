/*---
description: "Splice replacement retains inserted identities and returns the exact removed value in an independent array through a constrained helper at number and object type arguments."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-type-aliases, ts-numbers, ts-objects]
---*/

// Splice replacement retains inserted identities and returns the exact removed value in an independent array; route: a constrained helper at number and object type arguments.
// Node prints writes-splice-generic-replace:ok.
type Token = { id: number };
function check<T extends number | Token>(first: T, second: T, last: T): void {
  const input: T[] = [first, second, last];
  const result = input.splice(1, 1, first, last);
  assert.compareArray(result, [second]);
  assert.compareArray(input, [first, first, last, last]);
  assert.sameValue(result === input, false);
  result[0] = first;
  assert.compareArray(input, [first, first, last, last]);
}
check<number>(-0, NaN, 9);
const first: Token = { id: 1 }, second: Token = { id: 2 }, last: Token = { id: 4 };
check<Token>(first, second, last);
console.log("writes-splice-generic-replace:ok");
