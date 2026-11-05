/*---
description: "Splice replacement retains inserted identities and returns the exact removed value in an independent array through a constrained helper at number and object type arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-type-aliases, ts-numbers, ts-objects]
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
// Splice replacement retains inserted identities and returns the exact removed value in an independent array; route: a constrained helper at number and object type arguments.
// Node prints writes-splice-generic-replace:ok.
type Token = { id: number };
function check<T extends number | Token>(first: T, second: T, last: T): void {
  const input: T[] = [first, second, last];
  const result = localSplice(input, 1, 1, first, last);
  assert.compareArray(result, [second]);
  assert.compareArray(input, [first, first, last, last]);
  assert.sameValue(result === input, false);
  result[0] = first;
  assert.compareArray(input, [first, first, last, last]);
}
check<number>(-0, NaN, 9);
const first: Token = { id: 1 }, second: Token = { id: 2 }, last: Token = { id: 4 };
check<Token>(first, second, last);
console.log("writes-splice-generic-replace:ok");
