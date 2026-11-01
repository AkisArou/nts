/*---
description: A Int32Array subclass constructed from a buffer crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// A buffer-constructed subclass is written through a Int32Array parameter; node preserves conversion, view metadata and own state.
const little = Object.is(new Uint8Array(new Uint16Array([0x0102]).buffer)[0], 2);
let constructions = 0;
class ContentsInt32Buffer extends Int32Array {
  marker: number = 17;
  reads: number = 0;
  constructor(buffer: ArrayBuffer, offset: number, length: number) { super(buffer, offset, length); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(view: Int32Array, input: number, expected: number, expectedBytes: number[], backing: ArrayBuffer): void {
  const length = 3;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 4);
  assert.sameValue(view.byteLength, length * 4);
  assert.sameValue(view.buffer, backing);
  assert.sameValue(backing.byteLength, 5 * 4);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 1 ? expected : 0), true);
  const bytes: Uint8Array = new Uint8Array(backing);
  assert.sameValue(bytes.length, 20); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 20);
  for (let i = 0; i < bytes.length; i++) {
    const at = i - 8;
    assert.sameValue(Object.is(bytes[i], at >= 0 && at < 4 ? expectedBytes[little ? at : 3 - at] : 0), true);
  }
  assert.sameValue(view instanceof ContentsInt32Buffer, true);
  assert.sameValue(view instanceof Int32Array, true);
  if (view instanceof ContentsInt32Buffer) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number, number[]][] = [[2147483648, -2147483648, [0, 0, 0, 128]], [-2147483649, 2147483647, [255, 255, 255, 127]], [4294967297, 1, [1, 0, 0, 0]]];
for (const [input, expected, expectedBytes] of inputs) {
  const before = constructions;
  const backing: ArrayBuffer = new ArrayBuffer(5 * 4);
  check(new ContentsInt32Buffer(backing, 4, 3), input, expected, expectedBytes, backing);
  assert.sameValue(constructions - before, 1);
}
