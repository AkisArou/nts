/*---
description: Fill through a constrained BigInt64Array generic wraps values at the signed 64-bit boundary.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-tuples, ts-generics, ts-generic-constraints]
---*/
// Write bigint values with fill through a generic view; node wraps to signed 64-bit values and keeps the boundary slots.
function check<V extends BigInt64Array>(view: V, n: bigint, expectedValue: bigint): void {
  view.set([7n, 8n, 9n, 10n]);
  const returned = view.fill(n, 1, 3);
  assert.sameValue(returned, view);
  const expected = [7n, expectedValue, expectedValue, 10n];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 32);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[9223372036854775808n, -9223372036854775808n], [18446744073709551617n, 1n], [-9223372036854775809n, 9223372036854775807n]]) check(new BigInt64Array(new ArrayBuffer(48), 8, 4), n, expectedValue);
