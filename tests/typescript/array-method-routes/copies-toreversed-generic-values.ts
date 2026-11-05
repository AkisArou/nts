/*---
description: "ToReversed preserves exact numeric and string values and leaves empty single and longer inputs unchanged through a constrained helper at number and string type arguments."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-readonly, ts-numbers, ts-strings]
---*/

// ToReversed preserves exact numeric and string values and leaves empty single and longer inputs unchanged; route: a constrained helper at number and string type arguments.
// Node prints copies-toreversed-generic-values:ok.
function check<T extends number | string>(input: readonly T[], expected: readonly T[]): void {
  const before: T[] = [];
  for (const value of input) before[before.length] = value;
  const result = input.toReversed();
  assert.compareArray(result, expected);
  assert.sameValue(result === input, false);
  assert.compareArray(input, before);
  if (Object.is(before[0], -0)) assert.sameValue(Object.is(result[result.length - 1], -0), true);
}
check<number>([], []);
check<number>([-0], [-0]);
check<number>([-0, NaN, 3, 8], [8, 3, NaN, -0]);
check<string>(["a", "", "tail"], ["tail", "", "a"]);
console.log("copies-toreversed-generic-values:ok");
