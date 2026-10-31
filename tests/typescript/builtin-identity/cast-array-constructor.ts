/*---
description: An own class cast to ArrayConstructor still runs its constructor.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-arrays, ts-instanceof]
---*/
// Route: a class is asserted to be Array; node constructs the own two-element object.
let calls = 0;
class OwnArray {
  readonly length: number = 2;
  readonly 0: number;
  readonly 1: number;
  constructor(n: number) { calls++; this[0] = n + 100; this[1] = n + 101; }
}
function check(n: number): void {
  calls = 0;
  const Target = OwnArray as unknown as typeof Array;
  const value = new Target<number>(n);
  assert.sameValue(calls, 1);
  assert.sameValue(value.length, 2);
  assert.sameValue<unknown>(value[0], n + 100);
  assert.sameValue<unknown>(value[1], n + 101);
  assert.sameValue(value instanceof OwnArray, true);
  assert.sameValue(value instanceof Array, false);
}
for (const n of [0, 1, 3, 7]) check(n);
