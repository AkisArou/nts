/*---
description: "Keys yields dense indices independently of element values on empty single and longer arrays through a declared static readonly-array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-null-undefined]
---*/

function* localKeys<T>(items: readonly T[]): Generator<number, void, unknown> {
  for (let i = 0; i < items.length; i++) yield i;
}
// Keys yields dense indices independently of element values on empty single and longer arrays; route: a declared static readonly-array field.
// Node prints copies-keys-static-field-indices:ok.
class KeySource {
  static items: readonly (number | string | undefined)[] = [];
  static enumerate(): Iterable<number> { return localKeys(this.items); }
}
const rows: readonly [readonly (number | string | undefined)[], readonly number[]][] = [[[], []], [[undefined], [0]], [["a", -0, NaN], [0, 1, 2]]];
for (const [input, expected] of rows) {
  KeySource.items = input;
  const before: (number | string | undefined)[] = [], result: number[] = [];
  for (const value of input) before[before.length] = value;
  for (const index of KeySource.enumerate()) result[result.length] = index;
  assert.compareArray(result, expected);
  assert.compareArray(KeySource.items, before);
}
console.log("copies-keys-static-field-indices:ok");
