/*---
description: Control for subclass-array-method-override; construct Array directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-arrays]
---*/
// Paired case: ../builtin-identity/subclass-array-method-override.ts.
// Change: Construct Array directly; adjust the subclass observations.
class IdentityArray extends Array<number> {
  override pop(): number | undefined {
    const value = super.pop();
    return value === undefined ? undefined : value + 100;
  }
}
function check(n: number): void {
  const result: number[] = new Array<number>(n, n + 1);
  assert.sameValue(result.pop(), n + 1);
  assert.sameValue(result.length, 1);
  assert.sameValue(result[0], n);
  assert.sameValue(result instanceof IdentityArray, false);
  assert.sameValue(result instanceof Array, true);
  assert.sameValue(new Array<number>(n, n + 1) instanceof IdentityArray, false);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
