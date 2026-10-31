/*---
description: Control for call-construct-array-new-negative-field; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-arrow-functions, ts-objects]
---*/
// Paired case: ../builtin-identity/call-construct-array-new-negative-field.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(n: number): number[] {
  const holder: { target: ArrayConstructor; value: number } = { target: Array, value: n };
  return new Array<number>(holder.value);
}
for (const n of [-1, -2, -11]) {
  assert.throws(RangeError, () => { build(n); });
}
