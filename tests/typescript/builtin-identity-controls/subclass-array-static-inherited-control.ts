/*---
description: Control for subclass-array-static-inherited; call Array.of directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-arrays, ts-instanceof, ts-functions]
---*/
// Paired case: ../builtin-identity/subclass-array-static-inherited.ts.
// Change: Call Array.of directly; adjust the subclass observations.
class IdentityArray extends Array<number> {}
function check(n: number): void {

  const result = Array.of(n, n + 1);

  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof IdentityArray, false);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(Array.of(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [0, 1, 17, 120]) check(n);
