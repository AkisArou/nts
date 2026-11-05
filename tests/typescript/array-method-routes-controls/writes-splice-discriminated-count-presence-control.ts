/*---
description: "Splice distinguishes an omitted count from explicit undefined negative zero NaN finite and infinite counts through a narrowed discriminated union of count arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-discriminated-unions, ts-unions, ts-type-aliases, ts-readonly, ts-tuples, ts-numbers, ts-null-undefined]
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
// Splice distinguishes an omitted count from explicit undefined negative zero NaN finite and infinite counts; route: a narrowed discriminated union of count arguments.
// Node prints writes-splice-discriminated-count-presence:ok.
type Action = { kind: "omitted" } | { kind: "undefined"; count: undefined } | { kind: "count"; count: number };
function remove(input: number[], action: Action): number[] {
  if (action.kind === "omitted") return localSplice(input, 1);
  return localSplice(input, 1, action.count);
}
const rows: readonly [Action, readonly number[], readonly number[]][] = [
  [{ kind: "omitted" }, [2, 3, 4], [1]], [{ kind: "undefined", count: undefined }, [], [1, 2, 3, 4]],
  [{ kind: "count", count: -2 }, [], [1, 2, 3, 4]], [{ kind: "count", count: -0 }, [], [1, 2, 3, 4]],
  [{ kind: "count", count: NaN }, [], [1, 2, 3, 4]], [{ kind: "count", count: 2 }, [2, 3], [1, 4]],
  [{ kind: "count", count: Infinity }, [2, 3, 4], [1]]
];
for (const [action, removed, remaining] of rows) {
  const input: number[] = [1, 2, 3, 4], result = remove(input, action);
  assert.compareArray(result, removed);
  assert.compareArray(input, remaining);
  assert.sameValue(result === input, false);
}
console.log("writes-splice-discriminated-count-presence:ok");
