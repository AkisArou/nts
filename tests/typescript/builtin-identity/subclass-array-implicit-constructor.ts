/*---
description: A Array subclass inherits its constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-arrays]
---*/
// Route: a typed Array subclass inherits its constructor; node preserves the subclass and its behavior.
class IdentityArray extends Array<number> {}
function check(n: number): void {
  const result: number[] = new IdentityArray(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof IdentityArray, true);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(new Array<number>(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
