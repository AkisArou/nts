/*---
description: Control for subclasses-biguint64-buffer; keep the subclass view in one exact local declaration.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-bigint]
---*/
// Only the base-typed view parameter is replaced by local construction; inputs, stores and observations are identical.
const little = Object.is(new Uint8Array(new Uint16Array([0x0102]).buffer)[0], 2);
let constructions = 0;
class ContentsBigUint64Buffer extends BigUint64Array {
  marker: number = 17;
  reads: number = 0;
  constructor(buffer: ArrayBuffer, offset: number, length: number) { super(buffer, offset, length); constructions++; }
  sample(index: number): bigint { this.reads++; return this[index]; }
}
function check(input: bigint, expected: bigint, expectedBytes: number[], backing: ArrayBuffer): void {
  const view: ContentsBigUint64Buffer = new ContentsBigUint64Buffer(backing, 8, 3);
  const length = 3;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, length * 8);
  assert.sameValue(view.buffer, backing);
  assert.sameValue(backing.byteLength, 5 * 8);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0n), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 1 ? expected : 0n), true);
  const bytes: Uint8Array = new Uint8Array(backing);
  assert.sameValue(bytes.length, 40); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 40);
  for (let i = 0; i < bytes.length; i++) {
    const at = i - 16;
    assert.sameValue(Object.is(bytes[i], at >= 0 && at < 8 ? expectedBytes[little ? at : 7 - at] : 0), true);
  }
  assert.sameValue(view instanceof ContentsBigUint64Buffer, true);
  assert.sameValue(view instanceof BigUint64Array, true);
  if (view instanceof ContentsBigUint64Buffer) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [bigint, bigint, number[]][] = [[-1n, 18446744073709551615n, [255, 255, 255, 255, 255, 255, 255, 255]], [18446744073709551616n, 0n, [0, 0, 0, 0, 0, 0, 0, 0]], [18446744073709551617n, 1n, [1, 0, 0, 0, 0, 0, 0, 0]]];
for (const [input, expected, expectedBytes] of inputs) {
  const before = constructions;
  const backing: ArrayBuffer = new ArrayBuffer(5 * 8);
  check(input, expected, expectedBytes, backing);
  assert.sameValue(constructions - before, 1);
}
