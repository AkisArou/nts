/*---
description: "Negative slice bounds retain exact numeric and reference values across empty single and longer arrays through a constrained helper at number and object type arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-readonly, ts-objects, ts-type-aliases, ts-numbers]
---*/

function localIndex(value: number, length: number): number {
  let index = value !== value ? 0 : value === Infinity ? length : value === -Infinity ? 0 : value - value % 1;
  if (index < 0) index += length;
  return index < 0 ? 0 : index > length ? length : index;
}
function localSlice<T>(items: readonly T[], start: number = 0, end: number = items.length): T[] {
  const result: T[] = [];
  for (let i = localIndex(start, items.length), stop = localIndex(end, items.length); i < stop; i++) result[result.length] = items[i];
  return result;
}
// Negative slice bounds retain exact numeric and reference values across empty single and longer arrays; route: a constrained helper at number and object type arguments.
// Node prints copies-slice-generic-tail:ok.
type Token = { id: number };
function check<T extends number | Token>(input: readonly T[], expected: readonly T[]): void {
  const before: T[] = [];
  for (const value of input) before[before.length] = value;
  const result = localSlice(input, -2);
  assert.compareArray(result, expected);
  assert.sameValue(result === input, false);
  assert.compareArray(input, before);
}
const first: Token = { id: 1 }, second: Token = { id: 2 }, third: Token = { id: 3 };
check<number>([-0, NaN, 7], [NaN, 7]);
check<number>([-0], [-0]);
check<number>([], []);
check<Token>([first, second, third], [second, third]);
check<Token>([first], [first]);
check<Token>([], []);
console.log("copies-slice-generic-tail:ok");
