/*---
description: An Array constructed through a typed parameter rejects each negative length with RangeError.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-arrow-functions, ts-construct-signatures]
---*/
// Route: a negative Array length through a typed parameter; node preserves the target and argument semantics.
function build(target: ArrayConstructor, n: number): number[] {
  return new target<number>(n);
}
for (const n of [-1, -2, -11]) {
  assert.throws(RangeError, () => { build(Array, n); });
}
