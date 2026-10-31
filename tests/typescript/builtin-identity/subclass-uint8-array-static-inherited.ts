/*---
description: A Uint8Array subclass inherits the static of factory.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-arrays, ts-instanceof, ts-functions]
---*/
// Route: a typed subclass inherits of; node allocates the subclass.
class IdentityBytes extends Uint8Array {}
function check(n: number): void {

  const result = IdentityBytes.of(n, n + 1);

  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof IdentityBytes, true);
  assert.sameValue(result instanceof Uint8Array, true);
  assert.sameValue(Uint8Array.of(n, n + 1) instanceof IdentityBytes, false);
}
for (const n of [0, 1, 17, 120]) check(n);
