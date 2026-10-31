/*---
description: Control for cast-function-array-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-arrays, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-function-array-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
function ownArray(n: number): number[] { calls++; return [n + 100, n + 101]; }
function check(n: number): void {
  calls = 0;
  const Target = Array;
  const value = new Target<number>(n);
  assert.sameValue(calls, 0);
  assert.sameValue(value.length, n);
  assert.sameValue<unknown>(value[0], undefined);
  assert.sameValue<unknown>(value[1], undefined);
  assert.sameValue(value instanceof ownArray, false);
  assert.sameValue(value instanceof Array, true);
}
for (const n of [0, 1, 3, 7]) check(n);
