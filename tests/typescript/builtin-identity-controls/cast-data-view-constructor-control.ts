/*---
description: Control for cast-data-view-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-numbers, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-data-view-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnView {
  readonly byteLength: number;
  constructor(buffer: ArrayBuffer, offset: number, length: number) {
    calls++; this.byteLength = length + 100;
  }
  getUint8(offset: number): number { return this.byteLength + offset; }
}
function check(length: number): void {
  calls = 0;
  const buffer = new ArrayBuffer(length + 3);
  const bytes = new Uint8Array(buffer);
  bytes[1] = length + 10;
  const Target = DataView;
  const value = new Target(buffer, 1, length);
  assert.sameValue(calls, 0);
  assert.sameValue(value.byteLength, length);
  assert.sameValue(value.getUint8(0), length + 10);
  assert.sameValue(value instanceof OwnView, false);
  assert.sameValue(value instanceof DataView, true);
}
for (const length of [1, 2, 4, 7]) check(length);
