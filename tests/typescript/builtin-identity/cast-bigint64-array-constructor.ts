/*---
description: An own class cast to BigInt64Array keeps its constructor and indexed values.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-index-signatures, ts-arrays, ts-instanceof, ts-bigint]
---*/
// Route: a class is asserted to be BigInt64Array; node constructs the own indexed object.
let calls = 0;
class OwnView {
  readonly length: number = 2;
  readonly byteLength: number = 99;
  [index: number]: bigint;
  constructor(values: bigint[]) {
    calls++; this[0] = values[0] + 100n; this[1] = values[1] + 100n;
  }
}
function check(n: bigint): void {
  calls = 0;
  const Target = OwnView as unknown as typeof BigInt64Array;
  const value = new Target([n, n + 1n]);
  assert.sameValue(calls, 1);
  assert.sameValue(value.length, 2);
  assert.sameValue(value.byteLength, 99);
  assert.sameValue(value[0], n + 100n);
  assert.sameValue(value[1], n + 101n);
  assert.sameValue(value instanceof OwnView, true);
  assert.sameValue(value instanceof BigInt64Array, false);
}
for (const n of [0n, 1n, 3n, 7n]) check(n);
