/*---
description: Control for subclass-array-static-override; call Array.of directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-arrays, ts-instanceof, ts-functions, ts-override]
---*/
// Paired case: ../builtin-identity/subclass-array-static-override.ts.
// Change: Call Array.of directly; adjust the subclass observations.
let calls = 0;
class IdentityArray extends Array<number> {
  static override of<T>(...items: T[]): T[] {
    calls++;
    return super.of(...items).reverse();
  }
}
function check(n: number): void {
  const before = calls;
  const result = Array.of(n, n + 1);
  assert.sameValue(calls - before, 0);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof IdentityArray, false);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(Array.of(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [0, 1, 17, 120]) check(n);
