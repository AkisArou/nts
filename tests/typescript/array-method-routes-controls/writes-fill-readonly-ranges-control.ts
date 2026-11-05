/*---
description: "Fill truncates and clamps range arguments and returns the receiver even for empty ranges through readonly tuples of start and end arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-numbers, ts-null-undefined]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localFill<T>(items: T[], value: T, start: number = 0, end: number = items.length): T[] {
  const first = localIndex(start, items.length), last = localIndex(end, items.length);
  for (let i = first; i < last; i++) items[i] = value;
  return items;
}
// Fill truncates and clamps range arguments and returns the receiver even for empty ranges; route: readonly tuples of start and end arguments.
// Node prints writes-fill-readonly-ranges:ok.
const rows: readonly [number | undefined, number | undefined, readonly number[]][] = [
  [undefined, undefined, [0, 0, 0, 0]], [1, -1, [1, 0, 0, 4]], [-2, undefined, [1, 2, 0, 0]],
  [3, 1, [1, 2, 3, 4]], [-9, 9, [0, 0, 0, 0]], [1.9, 3.9, [1, 0, 0, 4]],
  [NaN, 2, [0, 0, 3, 4]], [Infinity, undefined, [1, 2, 3, 4]], [-Infinity, Infinity, [0, 0, 0, 0]]
];
for (const [start, end, expected] of rows) {
  const input: number[] = [1, 2, 3, 4];
  const result = localFill(input, 0, start, end);
  assert.sameValue(result === input, true);
  assert.compareArray(input, expected);
  assert.compareArray(result, expected);
}
console.log("writes-fill-readonly-ranges:ok");
