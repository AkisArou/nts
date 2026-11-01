/*---
description: A BigInt64Array subclass constructed from a buffer crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-bigint]
---*/
// A buffer-constructed subclass is written through a BigInt64Array parameter; node preserves conversion, view metadata and own state.
const little = Object.is(new Uint8Array(new Uint16Array([0x0102]).buffer)[0], 2);
let constructions = 0;
class ContentsBigInt64Buffer extends BigInt64Array {
  marker: number = 17;
  reads: number = 0;
  constructor(buffer: ArrayBuffer, offset: number, length: number) { super(buffer, offset, length); constructions++; }
  sample(index: number): bigint { this.reads++; return this[index]; }
}
function check(view: BigInt64Array, input: bigint, expected: bigint, expectedBytes: number[], backing: ArrayBuffer): void {
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
  assert.sameValue(view instanceof ContentsBigInt64Buffer, true);
  assert.sameValue(view instanceof BigInt64Array, true);
  if (view instanceof ContentsBigInt64Buffer) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [bigint, bigint, number[]][] = [[9223372036854775808n, -9223372036854775808n, [0, 0, 0, 0, 0, 0, 0, 128]], [-9223372036854775809n, 9223372036854775807n, [255, 255, 255, 255, 255, 255, 255, 127]], [18446744073709551617n, 1n, [1, 0, 0, 0, 0, 0, 0, 0]]];
for (const [input, expected, expectedBytes] of inputs) {
  const before = constructions;
  const backing: ArrayBuffer = new ArrayBuffer(5 * 8);
  check(new ContentsBigInt64Buffer(backing, 8, 3), input, expected, expectedBytes, backing);
  assert.sameValue(constructions - before, 1);
}
