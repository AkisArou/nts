/*---
description: A Array subclass dispatches an override through a base-typed value.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-arrays]
---*/
// Route: a typed Array subclass dispatches an override through a base-typed value; node preserves the subclass and its behavior.
class IdentityArray extends Array<number> {
  override pop(): number | undefined {
    const value = super.pop();
    return value === undefined ? undefined : value + 100;
  }
}
function check(n: number): void {
  const result: number[] = new IdentityArray(n, n + 1);
  assert.sameValue(result.pop(), n + 101);
  assert.sameValue(result.length, 1);
  assert.sameValue(result[0], n);
  assert.sameValue(result instanceof IdentityArray, true);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(new Array<number>(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
