/*---
description: A Uint32Array subclass constructed from a length crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// A length-constructed subclass is written through a Uint32Array parameter; node preserves conversion, view metadata and own state.
let constructions = 0;
class ContentsUint32Length extends Uint32Array {
  marker: number = 17;
  reads: number = 0;
  constructor(length: number) { super(length); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(view: Uint32Array, input: number, expected: number, length: number): void {
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 4);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0), true);
  view[length - 1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === length - 1 ? expected : 0), true);
  assert.sameValue(view instanceof ContentsUint32Length, true);
  assert.sameValue(view instanceof Uint32Array, true);
  if (view instanceof ContentsUint32Length) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(length - 1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number, number][] = [[2147483648, 2147483648, 2], [4294967296, 0, 3], [-1, 4294967295, 4]];
for (const [input, expected, length] of inputs) {
  const before = constructions;
  check(new ContentsUint32Length(length), input, expected, length);
  assert.sameValue(constructions - before, 1);
}
