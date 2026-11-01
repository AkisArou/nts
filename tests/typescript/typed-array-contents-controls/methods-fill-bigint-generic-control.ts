/*---
description: Control for methods-fill-bigint-generic; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-tuples, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/methods-fill-bigint-generic.ts; same operations and assertions, with the typed route removed.
function check(n: bigint, expectedValue: bigint): void {
  const view: BigInt64Array = new BigInt64Array(new ArrayBuffer(48), 8, 4);
  view.set([7n, 8n, 9n, 10n]);
  const returned = view.fill(n, 1, 3);
  assert.sameValue(returned, view);
  const expected = [7n, expectedValue, expectedValue, 10n];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 32);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const [n, expectedValue] of [[9223372036854775808n, -9223372036854775808n], [18446744073709551617n, 1n], [-9223372036854775809n, 9223372036854775807n]]) check(n, expectedValue);
