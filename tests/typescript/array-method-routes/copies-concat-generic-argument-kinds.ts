/*---
description: "Concat appends scalar arguments and one level of array arguments while retaining exact values and references through a constrained helper at number string and object type arguments."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-readonly, ts-objects, ts-type-aliases, ts-numbers, ts-strings]
---*/

// Concat appends scalar arguments and one level of array arguments while retaining exact values and references; route: a constrained helper at number string and object type arguments.
// Node prints copies-concat-generic-argument-kinds:ok.
type Token = { id: number };
function check<T extends number | string | Token>(first: T, second: T, third: T): void {
  const input: readonly T[] = [first], tail: readonly T[] = [third, first];
  const result = input.concat(second, tail);
  assert.compareArray(result, [first, second, third, first]);
  assert.sameValue(result === input, false);
  assert.sameValue(result === tail, false);
  assert.compareArray(input, [first]);
  assert.compareArray(tail, [third, first]);
  result[0] = second;
  assert.compareArray(input, [first]);
}
check<number>(-0, NaN, 7);
check<string>("first", "", "third");
const first: Token = { id: 1 }, second: Token = { id: 2 }, third: Token = { id: 3 };
check<Token>(first, second, third);
console.log("copies-concat-generic-argument-kinds:ok");
