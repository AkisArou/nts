/*---
description: "With copies unsigned 64 bit values at start middle and negative indexes while rejected indexes leave the source intact through readonly replacement tuples."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring, ts-arrow-functions, ts-errors]
---*/

// With copies unsigned 64 bit values at start middle and negative indexes while rejected indexes leave the source intact; route: readonly replacement tuples. Node prints copies-with-biguint-readonly-indices:ok.
type View = BigUint64Array;
function elements(view: View): bigint[] {
  const result: bigint[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
const source: View = new BigUint64Array([0n, 9223372036854775808n, 18446744073709551615n]);
const rows: readonly [number, bigint, readonly bigint[]][] = [
  [0, 7n, [7n, 9223372036854775808n, 18446744073709551615n]], [-1, 3n, [0n, 9223372036854775808n, 3n]],
  [1, 18446744073709551615n, [0n, 18446744073709551615n, 18446744073709551615n]],
];
for (const [index, value, expected] of rows) {
  const result: View = source.with(index, value);
  assert.sameValue(result instanceof BigUint64Array, true); assert.sameValue(result.buffer === source.buffer, false);
  assert.compareArray(elements(result), expected);
  result[0] = 9n; assert.compareArray(elements(source), [0n, 9223372036854775808n, 18446744073709551615n]);
}
for (const index of [-4, 3]) assert.throws(RangeError, () => source.with(index, 0n));
assert.compareArray(elements(source), [0n, 9223372036854775808n, 18446744073709551615n]);
console.log("copies-with-biguint-readonly-indices:ok");
