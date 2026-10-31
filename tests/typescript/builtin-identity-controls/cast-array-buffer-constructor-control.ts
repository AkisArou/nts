/*---
description: Control for cast-array-buffer-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-numbers, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-array-buffer-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnBuffer {
  readonly byteLength: number;
  constructor(length: number) { calls++; this.byteLength = length + 100; }
}
function check(length: number): void {
  calls = 0;
  const Target = ArrayBuffer;
  const value = new Target(length);
  assert.sameValue(calls, 0);
  assert.sameValue(value.byteLength, length);
  assert.sameValue(value instanceof OwnBuffer, false);
  assert.sameValue(value instanceof ArrayBuffer, true);
}
for (const length of [0, 1, 3, 7]) check(length);
