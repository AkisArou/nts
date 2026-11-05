/*---
description: "Splice counts negative starts from the end and truncates or clamps range arguments through readonly tuples of start and count plans. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-numbers]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localSplice<T>(items: T[], start: number, count?: number, ...insert: T[]): T[] {
  const first = localIndex(start, items.length), before: T[] = [], result: T[] = [];
  for (const value of items) before[before.length] = value;
  let removed = arguments.length < 3 ? before.length - first : count === undefined || count !== count || count < 0 ? 0 : count === Infinity ? before.length : count - count % 1;
  if (removed > before.length - first) removed = before.length - first;
  for (let i = first; i < first + removed; i++) result[result.length] = before[i];
  let next = first;
  for (const value of insert) items[next++] = value;
  for (let i = first + removed; i < before.length; i++) items[next++] = before[i];
  items.length = next;
  return result;
}
// Splice counts negative starts from the end and truncates or clamps range arguments; route: readonly tuples of start and count plans.
// Node prints writes-splice-readonly-negative-ranges:ok.
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [-2, 1, [4], [1, 2, 3, 5]], [-8, 2, [1, 2], [3, 4, 5]], [-1.9, 1, [5], [1, 2, 3, 4]],
  [1.9, 2.8, [2, 3], [1, 4, 5]], [NaN, 1, [1], [2, 3, 4, 5]],
  [Infinity, 2, [], [1, 2, 3, 4, 5]], [-Infinity, 1, [1], [2, 3, 4, 5]]
];
for (const [start, count, removed, remaining] of rows) {
  const input: number[] = [1, 2, 3, 4, 5];
  const result = localSplice(input, start, count);
  assert.compareArray(result, removed);
  assert.compareArray(input, remaining);
  assert.sameValue(result === input, false);
}
console.log("writes-splice-readonly-negative-ranges:ok");
