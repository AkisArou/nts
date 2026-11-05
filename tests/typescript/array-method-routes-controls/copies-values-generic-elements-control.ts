/*---
description: "Values yields exact numeric and reference elements in source order without changing the array through a constrained readonly helper at number and object type arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-readonly, ts-objects, ts-type-aliases, ts-numbers]
---*/

function* localValues<T>(items: readonly T[]): Generator<T, void, unknown> {
  for (let i = 0; i < items.length; i++) yield items[i];
}
// Values yields exact numeric and reference elements in source order without changing the array; route: a constrained readonly helper at number and object type arguments.
// Node prints copies-values-generic-elements:ok.
type Token = { id: number };
function check<T extends number | Token>(input: readonly T[], expected: readonly T[]): void {
  const result: T[] = [];
  for (const value of localValues(input)) result[result.length] = value;
  assert.compareArray(result, expected);
  assert.compareArray(input, expected);
  if (Object.is(expected[0], -0)) assert.sameValue(Object.is(result[0], -0), true);
}
check<number>([], []);
check<number>([-0], [-0]);
check<number>([-0, NaN, 9], [-0, NaN, 9]);
const first: Token = { id: 1 }, second: Token = { id: 2 }, third: Token = { id: 3 };
check<Token>([first], [first]);
check<Token>([first, second, first, third], [first, second, first, third]);
console.log("copies-values-generic-elements:ok");
