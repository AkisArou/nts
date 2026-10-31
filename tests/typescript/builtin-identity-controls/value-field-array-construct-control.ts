/*---
description: Control for value-field-array-construct; use the direct Array target at the invocation.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-class, ts-class-fields, ts-construct-signatures]
---*/
// Paired case: ../builtin-identity/value-field-array-construct.ts.
// Change: Use the direct Array target at the invocation.
class Holder {
  target: ArrayConstructor;
  constructor(target: ArrayConstructor) { this.target = target; }
}
function check(n: number): void {
  const holder = new Holder(Array);
  const result: number[] = new Array<number>(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
