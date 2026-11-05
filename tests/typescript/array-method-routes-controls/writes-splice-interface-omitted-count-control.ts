/*---
description: "Splice with only a start removes to the end including negative starts on empty single and longer arrays through two interface implementations supplying splice operations. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-class, ts-interfaces, ts-readonly, ts-tuples, ts-numbers]
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
// Splice with only a start removes to the end including negative starts on empty single and longer arrays; route: two interface implementations supplying splice operations.
// Node prints writes-splice-interface-omitted-count:ok.
interface Remover { remove(input: number[]): number[] }
class TailRemover implements Remover { remove(input: number[]): number[] { return localSplice(input, 1); } }
class NegativeRemover implements Remover { remove(input: number[]): number[] { return localSplice(input, -2); } }
const tail: Remover = new TailRemover(), negative: Remover = new NegativeRemover();
const rows: readonly [Remover, number[], readonly number[], readonly number[]][] = [
  [tail, [], [], []], [tail, [9], [], [9]], [tail, [1, 2, 3, 4, 5], [2, 3, 4, 5], [1]],
  [negative, [], [], []], [negative, [9], [9], []], [negative, [1, 2, 3, 4, 5], [4, 5], [1, 2, 3]]
];
for (const [remover, input, removed, remaining] of rows) {
  const result = remover.remove(input);
  assert.compareArray(result, removed);
  assert.compareArray(input, remaining);
  assert.sameValue(result === input, false);
}
console.log("writes-splice-interface-omitted-count:ok");
