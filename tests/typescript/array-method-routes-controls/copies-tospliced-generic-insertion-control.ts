/*---
description: "ToSpliced zero deletion inserts exact values into fresh empty single and longer arrays through a constrained helper at number and object type arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-readonly, ts-tuples, ts-type-aliases, ts-numbers, ts-objects]
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
// ToSpliced zero deletion inserts exact values into fresh empty single and longer arrays; route: a constrained helper at number and object type arguments.
// Node prints copies-tospliced-generic-insertion:ok.
type Token = { id: number };
function check<T extends number | Token>(first: T, second: T, last: T): void {
  const rows: readonly [readonly T[], readonly T[]][] = [[[], [second, first]], [[last], [last, second, first]], [[first, second, last], [first, second, first, second, last]]];
  for (const [input, expected] of rows) {
    const before: T[] = [];
    for (const value of input) before[before.length] = value;
    const result = localToSpliced(input, 1, 0, second, first);
    assert.compareArray(result, expected);
    assert.sameValue(result === input, false);
    assert.compareArray(input, before);
    result[0] = last;
    assert.compareArray(input, before);
  }
}
check<number>(-0, NaN, 7);
const first: Token = { id: 1 }, second: Token = { id: 2 }, last: Token = { id: 4 };
check<Token>(first, second, last);
console.log("copies-tospliced-generic-insertion:ok");
