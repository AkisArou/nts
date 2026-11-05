/*---
description: "Reverse retains the signed bigint kind storage identity and all exact wide values while reversing in place through a static signed bigint-array field."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring]
---*/

// Reverse retains the signed bigint kind storage identity and all exact wide values while reversing in place; route: a static signed bigint-array field. Node prints copies-reverse-bigint-static-field:ok.
type View = BigInt64Array;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
class BigBank { static data: View = new BigInt64Array([]); }
const rows: readonly [readonly bigint[], readonly bigint[]][] = [
  [[-9223372036854775808n, 0n, 9223372036854775807n, 1n], [1n, 9223372036854775807n, 0n, -9223372036854775808n]],
  [[7n, -3n, 2n], [2n, -3n, 7n]], [[9n], [9n]],
];
for (const [input, expected] of rows) {
  BigBank.data = new BigInt64Array(input);
  const original: View = BigBank.data, buffer = original.buffer, result: View = BigBank.data.reverse();
  assert.sameValue(result instanceof BigInt64Array, true); assert.sameValue(result, original);
  assert.sameValue(result.buffer, buffer); assert.compareArray(elements(BigBank.data), expected);
}
console.log("copies-reverse-bigint-static-field:ok");
