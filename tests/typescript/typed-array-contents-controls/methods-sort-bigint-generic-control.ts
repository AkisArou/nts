/*---
description: Control for methods-sort-bigint-generic; the view is held locally in its exact type.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/methods-sort-bigint-generic.ts; same operations and assertions, with the typed route removed.
function check(n: bigint): void {
  const view: BigInt64Array = new BigInt64Array(new ArrayBuffer(48), 8, 4);
  view.set([n + 10n, n + 2n, -1n, 0n]);
  const returned = view.sort();
  assert.sameValue(returned, view);
  const expected = [-1n, 0n, n + 2n, n + 10n];
  assert.sameValue(view.length, 4);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 32);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [0n, 2n, 8n]) check(n);
