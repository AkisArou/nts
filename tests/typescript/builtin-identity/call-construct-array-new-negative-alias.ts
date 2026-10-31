/*---
description: An Array constructed through a typed alias rejects each negative length with RangeError.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-arrow-functions]
---*/
// Route: a negative Array length through a typed alias; node preserves the target and argument semantics.
function build(n: number): number[] {
  const target: ArrayConstructor = Array;
  return new target<number>(n);
}
for (const n of [-1, -2, -11]) {
  assert.throws(RangeError, () => { build(n); });
}
