/*---
description: A Uint8ClampedArray subclass constructed from a length crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// A length-constructed subclass is written through a Uint8ClampedArray parameter; node preserves conversion, view metadata and own state.
let constructions = 0;
class ContentsUint8ClampedLength extends Uint8ClampedArray {
  marker: number = 17;
  reads: number = 0;
  constructor(length: number) { super(length); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(view: Uint8ClampedArray, input: number, expected: number, length: number): void {
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 1);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0), true);
  view[length - 1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === length - 1 ? expected : 0), true);
  assert.sameValue(view instanceof ContentsUint8ClampedLength, true);
  assert.sameValue(view instanceof Uint8ClampedArray, true);
  if (view instanceof ContentsUint8ClampedLength) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(length - 1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number, number][] = [[256, 255, 2], [-1, 0, 3], [2.5, 2, 4], [3.5, 4, 5]];
for (const [input, expected, length] of inputs) {
  const before = constructions;
  check(new ContentsUint8ClampedLength(length), input, expected, length);
  assert.sameValue(constructions - before, 1);
}
