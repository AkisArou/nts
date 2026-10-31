/*---
description: An Array constructed through a typed field rejects each negative length with RangeError.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-arrow-functions, ts-objects]
---*/
// Route: a negative Array length through a typed field; node preserves the target and argument semantics.
function build(n: number): number[] {
  const holder: { target: ArrayConstructor; value: number } = { target: Array, value: n };
  return new holder.target<number>(holder.value);
}
for (const n of [-1, -2, -11]) {
  assert.throws(RangeError, () => { build(n); });
}
