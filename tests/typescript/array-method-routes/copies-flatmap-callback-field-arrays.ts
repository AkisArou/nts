/*---
description: "FlatMap concatenates each callback array by one level across empty single and longer inputs through a declared callback field."
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-arrow-functions, ts-readonly, ts-tuples, ts-numbers]
---*/

// FlatMap concatenates each callback array by one level across empty single and longer inputs; route: a declared callback field.
// Node prints copies-flatmap-callback-field-arrays:ok.
class Expander {
  expand: (value: number) => readonly number[] = (value: number) => [value, value * 2];
}
const expander: Expander = new Expander();
const rows: readonly [number[], readonly number[]][] = [[[], []], [[2], [2, 4]], [[1, 3, 2], [1, 2, 3, 6, 2, 4]]];
for (const [input, expected] of rows) {
  const before: number[] = [];
  for (const value of input) before[before.length] = value;
  const result = input.flatMap(expander.expand);
  assert.compareArray(result, expected);
  assert.sameValue(result === input, false);
  assert.compareArray(input, before);
}
console.log("copies-flatmap-callback-field-arrays:ok");
