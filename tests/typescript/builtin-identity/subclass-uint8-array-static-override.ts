/*---
description: A Uint8Array subclass overrides the static of factory.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-arrays, ts-instanceof, ts-functions, ts-override]
---*/
// Route: a typed subclass overrides of and reverses its items; node allocates the subclass.
let calls = 0;
class IdentityBytes extends Uint8Array {
  static override of(...items: number[]) {
    calls++;
    return super.of(...items).reverse();
  }
}
function check(n: number): void {
  const before = calls;
  const result = IdentityBytes.of(n, n + 1);
  assert.sameValue(calls - before, 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n + 1);
  assert.sameValue(result[1], n);
  assert.sameValue(result instanceof IdentityBytes, true);
  assert.sameValue(result instanceof Uint8Array, true);
  assert.sameValue(Uint8Array.of(n, n + 1) instanceof IdentityBytes, false);
}
for (const n of [0, 1, 17, 120]) check(n);
