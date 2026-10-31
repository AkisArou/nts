/*---
description: Control for subclass-array-implicit-constructor; construct Array directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-arrays]
---*/
// Paired case: ../builtin-identity/subclass-array-implicit-constructor.ts.
// Change: Construct Array directly; adjust the subclass observations.
class IdentityArray extends Array<number> {}
function check(n: number): void {
  const result: number[] = new Array<number>(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof IdentityArray, false);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(new Array<number>(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
