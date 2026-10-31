/*---
description: Control for cast-uint8-clamped-array-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-index-signatures, ts-arrays, ts-instanceof, ts-numbers]
---*/
// Paired case: ../builtin-identity/cast-uint8-clamped-array-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnView {
  readonly length: number = 2;
  readonly byteLength: number = 99;
  [index: number]: number;
  constructor(values: number[]) {
    calls++; this[0] = values[0] + 100; this[1] = values[1] + 100;
  }
}
function check(n: number): void {
  calls = 0;
  const Target = Uint8ClampedArray;
  const value = new Target([n, n + 1]);
  assert.sameValue(calls, 0);
  assert.sameValue(value.length, 2);
  assert.sameValue(value.byteLength, 2);
  assert.sameValue(value[0], n);
  assert.sameValue(value[1], n + 1);
  assert.sameValue(value instanceof OwnView, false);
  assert.sameValue(value instanceof Uint8ClampedArray, true);
}
for (const n of [0, 1, 3, 7]) check(n);
