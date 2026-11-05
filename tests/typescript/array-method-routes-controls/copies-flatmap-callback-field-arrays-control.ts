/*---
description: "FlatMap concatenates each callback array by one level across empty single and longer inputs through a declared callback field. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-arrow-functions, ts-readonly, ts-tuples, ts-numbers]
---*/

function localFlatMap<T, U>(items: readonly T[], callback: (value: T, index: number, array: readonly T[]) => readonly U[]): U[] {
  const result: U[] = [];
  for (let i = 0; i < items.length; i++) {
    const part = callback(items[i], i, items);
    for (let j = 0; j < part.length; j++) result[result.length] = part[j];
  }
  return result;
}
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
  const result = localFlatMap(input, expander.expand);
  assert.compareArray(result, expected);
  assert.sameValue(result === input, false);
  assert.compareArray(input, before);
}
console.log("copies-flatmap-callback-field-arrays:ok");
