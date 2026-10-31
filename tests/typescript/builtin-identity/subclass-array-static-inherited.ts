/*---
description: A Array subclass inherits the static of factory.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-arrays, ts-instanceof, ts-functions]
---*/
// Route: a typed subclass inherits of; node allocates the subclass.
class IdentityArray extends Array<number> {}
function check(n: number): void {

  const result = IdentityArray.of(n, n + 1);

  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof IdentityArray, true);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(Array.of(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [0, 1, 17, 120]) check(n);
