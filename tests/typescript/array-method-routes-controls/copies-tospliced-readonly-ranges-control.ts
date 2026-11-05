/*---
description: "ToSpliced normalizes starts and counts while inserting deleting and replacing into a new array through readonly tuples of splice arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-numbers, ts-strings, ts-spread]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localToSpliced<T>(items: readonly T[], start: number, count?: number, ...insert: T[]): T[] {
  const first = localIndex(start, items.length), result: T[] = [];
  let removed = arguments.length < 3 ? items.length - first : count === undefined || count !== count || count < 0 ? 0 : count === Infinity ? items.length : count - count % 1;
  if (removed > items.length - first) removed = items.length - first;
  for (let i = 0; i < first; i++) result[result.length] = items[i];
  for (const value of insert) result[result.length] = value;
  for (let i = first + removed; i < items.length; i++) result[result.length] = items[i];
  return result;
}
// ToSpliced normalizes starts and counts while inserting deleting and replacing into a new array; route: readonly tuples of splice arguments.
// Node prints copies-tospliced-readonly-ranges:ok.
const input: readonly string[] = ["a", "b", "c", "d"];
const rows: readonly [number, number, string[], readonly string[]][] = [
  [1, 2, ["x"], ["a", "x", "d"]], [-2, 1, ["x", "y"], ["a", "b", "x", "y", "d"]],
  [1, 0, ["x"], ["a", "x", "b", "c", "d"]], [9, 3, ["x"], ["a", "b", "c", "d", "x"]],
  [-9, 1, ["x"], ["x", "b", "c", "d"]], [1.9, 1.9, ["x"], ["a", "x", "c", "d"]],
  [2, -1, ["x"], ["a", "b", "x", "c", "d"]], [1, Infinity, [], ["a"]]
];
for (const [start, count, insert, expected] of rows) {
  const result = localToSpliced(input, start, count, ...insert);
  assert.compareArray(result, expected);
  assert.sameValue(result === input, false);
  assert.compareArray(input, ["a", "b", "c", "d"]);
}
console.log("copies-tospliced-readonly-ranges:ok");
