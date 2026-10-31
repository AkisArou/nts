/*---
description: A Uint8Array subclass inherits its constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-arrays, ts-numbers]
---*/
// Route: a typed Uint8Array subclass inherits its constructor; node preserves the subclass and its behavior.
class IdentityBytes extends Uint8Array {}
function check(n: number): void {
  const result: Uint8Array = new IdentityBytes([n, n + 1]);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], (n + 1) % 256);
  assert.sameValue(result instanceof IdentityBytes, true);
  assert.sameValue(result instanceof Uint8Array, true);
  assert.sameValue(new Uint8Array([n, n + 1]) instanceof IdentityBytes, false);
}
for (const n of [0, 1, 17, 255]) check(n);
