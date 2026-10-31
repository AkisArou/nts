/*---
description: Control for value-variable-array-call; use the direct Array target at the invocation.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-call-signatures]
---*/
// Paired case: ../builtin-identity/value-variable-array-call.ts.
// Change: Use the direct Array target at the invocation.
function check(n: number): void {
  const Target: ArrayConstructor = Array;
  const result: number[] = Array<number>(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
