/*---
description: A Int16Array subclass constructed from a buffer crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// A buffer-constructed subclass is written through a Int16Array parameter; node preserves conversion, view metadata and own state.
const little = Object.is(new Uint8Array(new Uint16Array([0x0102]).buffer)[0], 2);
let constructions = 0;
class ContentsInt16Buffer extends Int16Array {
  marker: number = 17;
  reads: number = 0;
  constructor(buffer: ArrayBuffer, offset: number, length: number) { super(buffer, offset, length); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(view: Int16Array, input: number, expected: number, expectedBytes: number[], backing: ArrayBuffer): void {
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
  assert.sameValue(view instanceof ContentsInt16Buffer, true);
  assert.sameValue(view instanceof Int16Array, true);
  if (view instanceof ContentsInt16Buffer) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number, number[]][] = [[32768, -32768, [0, 128]], [-32769, 32767, [255, 127]], [-Infinity, 0, [0, 0]]];
for (const [input, expected, expectedBytes] of inputs) {
  const before = constructions;
  const backing: ArrayBuffer = new ArrayBuffer(5 * 2);
  check(new ContentsInt16Buffer(backing, 2, 3), input, expected, expectedBytes, backing);
  assert.sameValue(constructions - before, 1);
}
