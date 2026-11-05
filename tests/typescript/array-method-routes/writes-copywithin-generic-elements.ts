/*---
description: "CopyWithin negative targets retain exact primitive and reference elements on empty single and longer arrays through a constrained helper at number and object type arguments."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-readonly, ts-tuples, ts-type-aliases, ts-numbers, ts-objects]
---*/

// CopyWithin negative targets retain exact primitive and reference elements on empty single and longer arrays; route: a constrained helper at number and object type arguments.
// Node prints writes-copywithin-generic-elements:ok.
type Token = { id: number };
function check<T extends number | Token>(first: T, second: T, third: T, last: T): void {
  const rows: readonly [T[], readonly T[]][] = [[[], []], [[first], [first]], [[first, second, third, last], [first, second, first, second]]];
  for (const [input, expected] of rows) {
    const result = input.copyWithin(-2, 0, 2);
    assert.sameValue(result === input, true);
    assert.compareArray(input, expected);
    if (input.length > 2 && Object.is(first, -0)) assert.sameValue(Object.is(input[2], -0), true);
  }
}
check<number>(-0, NaN, 3, 8);
const first: Token = { id: 1 }, second: Token = { id: 2 }, third: Token = { id: 3 }, last: Token = { id: 4 };
check<Token>(first, second, third, last);
console.log("writes-copywithin-generic-elements:ok");
