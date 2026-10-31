/*---
description: A Array subclass overrides the static of factory.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-arrays, ts-instanceof, ts-functions, ts-override]
---*/
// Route: a typed subclass overrides of and reverses its items; node allocates the subclass.
let calls = 0;
class IdentityArray extends Array<number> {
  static override of<T>(...items: T[]): T[] {
    calls++;
    return super.of(...items).reverse();
  }
}
function check(n: number): void {
  const before = calls;
  const result = IdentityArray.of(n, n + 1);
  assert.sameValue(calls - before, 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n + 1);
  assert.sameValue(result[1], n);
  assert.sameValue(result instanceof IdentityArray, true);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(Array.of(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [0, 1, 17, 120]) check(n);
