/*---
description: An own class cast to ArrayBufferConstructor retains its own byte length.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-numbers, ts-instanceof]
---*/
// Route: a class is asserted to be ArrayBuffer; node constructs the own buffer look-alike.
let calls = 0;
class OwnBuffer {
  readonly byteLength: number;
  constructor(length: number) { calls++; this.byteLength = length + 100; }
}
function check(length: number): void {
  calls = 0;
  const Target = OwnBuffer as unknown as typeof ArrayBuffer;
  const value = new Target(length);
  assert.sameValue(calls, 1);
  assert.sameValue(value.byteLength, length + 100);
  assert.sameValue(value instanceof OwnBuffer, true);
  assert.sameValue(value instanceof ArrayBuffer, false);
}
for (const length of [0, 1, 3, 7]) check(length);
