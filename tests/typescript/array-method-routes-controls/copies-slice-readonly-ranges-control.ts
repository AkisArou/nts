/*---
description: "Slice truncates and clamps positive negative omitted and nonfinite bounds into independent copies through readonly tuples of range arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-numbers, ts-null-undefined]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localSlice<T>(items: readonly T[], start: number = 0, end: number = items.length): T[] {
  const result: T[] = [];
  for (let i = localIndex(start, items.length), stop = localIndex(end, items.length); i < stop; i++) result[result.length] = items[i];
  return result;
}
// Slice truncates and clamps positive negative omitted and nonfinite bounds into independent copies; route: readonly tuples of range arguments.
// Node prints copies-slice-readonly-ranges:ok.
const input: readonly number[] = [10, 20, 30, 40];
const rows: readonly [number | undefined, number | undefined, readonly number[]][] = [
  [undefined, undefined, [10, 20, 30, 40]], [-2, undefined, [30, 40]], [1, -1, [20, 30]],
  [3, 1, []], [-9, 9, [10, 20, 30, 40]], [1.9, 3.9, [20, 30]],
  [NaN, 2, [10, 20]], [Infinity, undefined, []], [-Infinity, Infinity, [10, 20, 30, 40]]
];
for (const [start, end, expected] of rows) {
  const result = localSlice(input, start, end);
  assert.compareArray(result, expected);
  assert.sameValue(result === input, false);
  assert.compareArray(input, [10, 20, 30, 40]);
}
console.log("copies-slice-readonly-ranges:ok");
