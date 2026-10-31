/*---
description: A Uint8Array subclass forwards typed arguments through its own constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-arrays, ts-numbers]
---*/
// Route: a typed Uint8Array subclass forwards typed arguments through its own constructor; node preserves the subclass and its behavior.
let constructions = 0;
class IdentityBytes extends Uint8Array {
  constructor(values: number[]) { super(values); constructions++; }
}
function check(n: number): void {
  const before = constructions;
  const result: Uint8Array = new IdentityBytes([n, n + 1]);
  assert.sameValue(constructions - before, 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], (n + 1) % 256);
  assert.sameValue(result instanceof IdentityBytes, true);
  assert.sameValue(result instanceof Uint8Array, true);
  assert.sameValue(new Uint8Array([n, n + 1]) instanceof IdentityBytes, false);
}
for (const n of [0, 1, 17, 255]) check(n);
