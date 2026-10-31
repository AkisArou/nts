/*---
description: Control for call-construct-array-new-negative-alias; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-arrow-functions]
---*/
// Paired case: ../builtin-identity/call-construct-array-new-negative-alias.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(n: number): number[] {
  const target: ArrayConstructor = Array;
  return new Array<number>(n);
}
for (const n of [-1, -2, -11]) {
  assert.throws(RangeError, () => { build(n); });
}
