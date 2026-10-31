/*---
description: Control for cast-biguint64-array-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-index-signatures, ts-arrays, ts-instanceof, ts-bigint]
---*/
// Paired case: ../builtin-identity/cast-biguint64-array-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
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
  const Target = BigUint64Array;
  const value = new Target([n, n + 1n]);
  assert.sameValue(calls, 0);
  assert.sameValue(value.length, 2);
  assert.sameValue(value.byteLength, 16);
  assert.sameValue(value[0], n);
  assert.sameValue(value[1], n + 1n);
  assert.sameValue(value instanceof OwnView, false);
  assert.sameValue(value instanceof BigUint64Array, true);
}
for (const n of [0n, 1n, 3n, 7n]) check(n);
