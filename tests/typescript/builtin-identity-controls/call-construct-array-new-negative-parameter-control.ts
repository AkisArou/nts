/*---
description: Control for call-construct-array-new-negative-parameter; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-arrow-functions, ts-construct-signatures]
---*/
// Paired case: ../builtin-identity/call-construct-array-new-negative-parameter.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(target: ArrayConstructor, n: number): number[] {
  return new Array<number>(n);
}
for (const n of [-1, -2, -11]) {
  assert.throws(RangeError, () => { build(Array, n); });
}
