/*---
description: An own class cast to Int16Array keeps its constructor and indexed values.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-index-signatures, ts-arrays, ts-instanceof, ts-numbers]
---*/
// Route: a class is asserted to be Int16Array; node constructs the own indexed object.
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
  const Target = OwnView as unknown as typeof Int16Array;
  const value = new Target([n, n + 1]);
  assert.sameValue(calls, 1);
  assert.sameValue(value.length, 2);
  assert.sameValue(value.byteLength, 99);
  assert.sameValue(value[0], n + 100);
  assert.sameValue(value[1], n + 101);
  assert.sameValue(value instanceof OwnView, true);
  assert.sameValue(value instanceof Int16Array, false);
}
for (const n of [0, 1, 3, 7]) check(n);
