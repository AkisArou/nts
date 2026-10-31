/*---
description: A Uint8Array subclass dispatches an override through a base-typed value.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-arrays, ts-numbers]
---*/
// Route: a typed Uint8Array subclass dispatches an override through a base-typed value; node preserves the subclass and its behavior.
class IdentityBytes extends Uint8Array {
  override at(index: number): number | undefined {
    const value = super.at(index);
    return value === undefined ? undefined : value + 100;
  }
}
function check(n: number): void {
  const result: Uint8Array = new IdentityBytes([n, n + 1]);
  assert.sameValue(result.length, 2);
  assert.sameValue(result.at(0), n + 100);
  assert.sameValue(result.at(1), (n + 1) % 256 + 100);
  assert.sameValue(result.at(2), undefined);
  assert.sameValue(result instanceof IdentityBytes, true);
  assert.sameValue(result instanceof Uint8Array, true);
  assert.sameValue(new Uint8Array([n, n + 1]) instanceof IdentityBytes, false);
}
for (const n of [0, 1, 17, 255]) check(n);
