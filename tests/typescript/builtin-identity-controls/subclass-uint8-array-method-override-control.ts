/*---
description: Control for subclass-uint8-array-method-override; construct Uint8Array directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-arrays, ts-numbers]
---*/
// Paired case: ../builtin-identity/subclass-uint8-array-method-override.ts.
// Change: Construct Uint8Array directly; adjust the subclass observations.
class IdentityBytes extends Uint8Array {
  override at(index: number): number | undefined {
    const value = super.at(index);
    return value === undefined ? undefined : value + 100;
  }
}
function check(n: number): void {
  const result: Uint8Array = new Uint8Array([n, n + 1]);
  assert.sameValue(result.length, 2);
  assert.sameValue(result.at(0), n);
  assert.sameValue(result.at(1), (n + 1) % 256);
  assert.sameValue(result.at(2), undefined);
  assert.sameValue(result instanceof IdentityBytes, false);
  assert.sameValue(result instanceof Uint8Array, true);
  assert.sameValue(new Uint8Array([n, n + 1]) instanceof IdentityBytes, false);
}
for (const n of [0, 1, 17, 255]) check(n);
