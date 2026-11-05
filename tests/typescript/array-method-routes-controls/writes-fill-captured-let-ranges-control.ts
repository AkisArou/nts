/*---
description: "Fill reads the current captured array and current bounds on every call including empty ranges through typed let bindings captured by a closure. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-closures, ts-arrow-functions, ts-readonly, ts-tuples, ts-numbers]
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
// Fill reads the current captured array and current bounds on every call including empty ranges; route: typed let bindings captured by a closure.
// Node prints writes-fill-captured-let-ranges:ok.
let items: number[] = [], start: number = 0, end: number = 0;
const write: () => number[] = () => localFill(items, 7, start, end);
const rows: readonly [number[], number, number, readonly number[]][] = [
  [[], 0, 2, []], [[1], 0, 1, [7]], [[1, 2, 3, 4], 1, -1, [1, 7, 7, 4]],
  [[1, 2, 3, 4], -2, 99, [1, 2, 7, 7]], [[1, 2, 3], 4, 9, [1, 2, 3]], [[1, 2, 3], 2, 1, [1, 2, 3]]
];
for (const [input, first, last, expected] of rows) {
  items = input;
  start = first;
  end = last;
  const result = write();
  assert.sameValue(result === input, true);
  assert.sameValue(items === input, true);
  assert.compareArray(input, expected);
}
console.log("writes-fill-captured-let-ranges:ok");
