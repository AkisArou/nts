/*---
description: "CopyWithin normalizes target start and end and handles both overlap directions while returning the same array through readonly tuples of index arguments."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-numbers, ts-null-undefined]
---*/

// CopyWithin normalizes target start and end and handles both overlap directions while returning the same array; route: readonly tuples of index arguments.
// Node prints writes-copywithin-readonly-ranges:ok.
const rows: readonly [number, number, number | undefined, readonly number[]][] = [
  [0, 3, undefined, [4, 5, 3, 4, 5]], [-2, 0, 2, [1, 2, 3, 1, 2]],
  [1, 0, 4, [1, 1, 2, 3, 4]], [0, 1, 4, [2, 3, 4, 4, 5]],
  [1.9, 2.8, 4.9, [1, 3, 4, 4, 5]], [-9, -2, undefined, [4, 5, 3, 4, 5]],
  [Infinity, 0, undefined, [1, 2, 3, 4, 5]], [0, 0, 0, [1, 2, 3, 4, 5]], [NaN, 3, 5, [4, 5, 3, 4, 5]]
];
for (const [target, start, end, expected] of rows) {
  const input: number[] = [1, 2, 3, 4, 5];
  const result = input.copyWithin(target, start, end);
  assert.sameValue(result === input, true);
  assert.compareArray(input, expected);
  assert.compareArray(result, expected);
}
console.log("writes-copywithin-readonly-ranges:ok");
