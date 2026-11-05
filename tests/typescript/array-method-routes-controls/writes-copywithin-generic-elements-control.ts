/*---
description: "CopyWithin negative targets retain exact primitive and reference elements on empty single and longer arrays through a constrained helper at number and object type arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-readonly, ts-tuples, ts-type-aliases, ts-numbers, ts-objects]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localCopyWithin<T>(items: T[], target: number, start: number, end: number = items.length): T[] {
  const to = localIndex(target, items.length), from = localIndex(start, items.length), last = localIndex(end, items.length), copied: T[] = [];
  for (let i = from; i < last && to + copied.length < items.length; i++) copied[copied.length] = items[i];
  for (let i = 0; i < copied.length; i++) items[to + i] = copied[i];
  return items;
}
// CopyWithin negative targets retain exact primitive and reference elements on empty single and longer arrays; route: a constrained helper at number and object type arguments.
// Node prints writes-copywithin-generic-elements:ok.
type Token = { id: number };
function check<T extends number | Token>(first: T, second: T, third: T, last: T): void {
  const rows: readonly [T[], readonly T[]][] = [[[], []], [[first], [first]], [[first, second, third, last], [first, second, first, second]]];
  for (const [input, expected] of rows) {
    const result = localCopyWithin(input, -2, 0, 2);
    assert.sameValue(result === input, true);
    assert.compareArray(input, expected);
    if (input.length > 2 && Object.is(first, -0)) assert.sameValue(Object.is(input[2], -0), true);
  }
}
check<number>(-0, NaN, 3, 8);
const first: Token = { id: 1 }, second: Token = { id: 2 }, third: Token = { id: 3 }, last: Token = { id: 4 };
check<Token>(first, second, third, last);
console.log("writes-copywithin-generic-elements:ok");
