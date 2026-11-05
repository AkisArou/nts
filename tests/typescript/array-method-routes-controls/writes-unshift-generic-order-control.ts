/*---
description: "Unshift preserves argument order and exact generic references while moving the old elements to the suffix through a constrained helper at number and object type arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-type-aliases, ts-numbers, ts-objects]
---*/

function localUnshift<T>(items: T[], ...values: T[]): number {
  for (let i = items.length - 1; i >= 0; i--) items[i + values.length] = items[i];
  for (let i = 0; i < values.length; i++) items[i] = values[i];
  return items.length;
}
// Unshift preserves argument order and exact generic references while moving the old elements to the suffix; route: a constrained helper at number and object type arguments.
// Node prints writes-unshift-generic-order:ok.
type Token = { id: number };
function check<T extends number | Token>(first: T, second: T, last: T): void {
  const input: T[] = [first, second];
  const result = localUnshift(input, last, first);
  assert.sameValue(result, 4);
  assert.compareArray(input, [last, first, first, second]);
  assert.sameValue(input.length, 4);
  if (Object.is(first, -0)) assert.sameValue(Object.is(input[1], -0), true);
}
check<number>(-0, NaN, 9);
const first: Token = { id: 1 }, second: Token = { id: 2 }, last: Token = { id: 4 };
check<Token>(first, second, last);
console.log("writes-unshift-generic-order:ok");
