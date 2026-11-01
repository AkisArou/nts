/*---
description: Control for subclasses-int8-buffer; keep the subclass view in one exact local declaration.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// Only the base-typed view parameter is replaced by local construction; inputs, stores and observations are identical.
let constructions = 0;
class ContentsInt8Buffer extends Int8Array {
  marker: number = 17;
  reads: number = 0;
  constructor(buffer: ArrayBuffer, offset: number, length: number) { super(buffer, offset, length); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(input: number, expected: number, expectedBytes: number[], backing: ArrayBuffer): void {
  const view: ContentsInt8Buffer = new ContentsInt8Buffer(backing, 1, 3);
  const length = 3;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 1);
  assert.sameValue(view.byteLength, length * 1);
  assert.sameValue(view.buffer, backing);
  assert.sameValue(backing.byteLength, 5 * 1);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 1 ? expected : 0), true);
  const bytes: Uint8Array = new Uint8Array(backing);
  assert.sameValue(bytes.length, 5); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 5);
  for (let i = 0; i < bytes.length; i++) {
    const at = i - 2;
    assert.sameValue(Object.is(bytes[i], at >= 0 && at < 1 ? expectedBytes[at] : 0), true);
  }
  assert.sameValue(view instanceof ContentsInt8Buffer, true);
  assert.sameValue(view instanceof Int8Array, true);
  if (view instanceof ContentsInt8Buffer) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number, number[]][] = [[128, -128, [128]], [-129, 127, [127]], [NaN, 0, [0]]];
for (const [input, expected, expectedBytes] of inputs) {
  const before = constructions;
  const backing: ArrayBuffer = new ArrayBuffer(5 * 1);
  check(input, expected, expectedBytes, backing);
  assert.sameValue(constructions - before, 1);
}
