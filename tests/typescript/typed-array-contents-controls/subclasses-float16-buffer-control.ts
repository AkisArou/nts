/*---
description: Control for subclasses-float16-buffer; keep the subclass view in one exact local declaration.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// Only the base-typed view parameter is replaced by local construction; inputs, stores and observations are identical.
const little = Object.is(new Uint8Array(new Uint16Array([0x0102]).buffer)[0], 2);
let constructions = 0;
class ContentsFloat16Buffer extends Float16Array {
  marker: number = 17;
  reads: number = 0;
  constructor(buffer: ArrayBuffer, offset: number, length: number) { super(buffer, offset, length); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(input: number, expected: number, expectedBytes: number[], backing: ArrayBuffer): void {
  const view: ContentsFloat16Buffer = new ContentsFloat16Buffer(backing, 2, 3);
  const length = 3;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 2);
  assert.sameValue(view.byteLength, length * 2);
  assert.sameValue(view.buffer, backing);
  assert.sameValue(backing.byteLength, 5 * 2);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 1 ? expected : 0), true);
  const bytes: Uint8Array = new Uint8Array(backing);
  assert.sameValue(bytes.length, 10); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 10);
  for (let i = 0; i < bytes.length; i++) {
    const at = i - 4;
    assert.sameValue(Object.is(bytes[i], at >= 0 && at < 2 ? expectedBytes[little ? at : 1 - at] : 0), true);
  }
  assert.sameValue(view instanceof ContentsFloat16Buffer, true);
  assert.sameValue(view instanceof Float16Array, true);
  if (view instanceof ContentsFloat16Buffer) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number, number[]][] = [[0.1, 0.0999755859375, [102, 46]], [65520, Infinity, [0, 124]], [1.00048828125, 1, [0, 60]], [-0, -0, [0, 128]]];
for (const [input, expected, expectedBytes] of inputs) {
  const before = constructions;
  const backing: ArrayBuffer = new ArrayBuffer(5 * 2);
  check(input, expected, expectedBytes, backing);
  assert.sameValue(constructions - before, 1);
}
