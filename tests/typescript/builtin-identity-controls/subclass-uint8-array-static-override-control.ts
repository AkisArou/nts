/*---
description: Control for subclass-uint8-array-static-override; call Uint8Array.of directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-arrays, ts-instanceof, ts-functions, ts-override]
---*/
// Paired case: ../builtin-identity/subclass-uint8-array-static-override.ts.
// Change: Call Uint8Array.of directly; adjust the subclass observations.
let calls = 0;
class IdentityBytes extends Uint8Array {
  static override of(...items: number[]) {
    calls++;
    return super.of(...items).reverse();
  }
}
function check(n: number): void {
  const before = calls;
  const result = Uint8Array.of(n, n + 1);
  assert.sameValue(calls - before, 0);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof IdentityBytes, false);
  assert.sameValue(result instanceof Uint8Array, true);
  assert.sameValue(Uint8Array.of(n, n + 1) instanceof IdentityBytes, false);
}
for (const n of [0, 1, 17, 120]) check(n);
