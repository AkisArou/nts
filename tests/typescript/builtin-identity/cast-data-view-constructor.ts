/*---
description: An own class cast to DataViewConstructor retains its own length and reader.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-numbers, ts-instanceof]
---*/
// Route: a class is asserted to be DataView; node invokes its own constructor and getUint8.
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
  const Target = OwnView as unknown as typeof DataView;
  const value = new Target(buffer, 1, length);
  assert.sameValue(calls, 1);
  assert.sameValue(value.byteLength, length + 100);
  assert.sameValue(value.getUint8(0), length + 100);
  assert.sameValue(value instanceof OwnView, true);
  assert.sameValue(value instanceof DataView, false);
}
for (const length of [1, 2, 4, 7]) check(length);
