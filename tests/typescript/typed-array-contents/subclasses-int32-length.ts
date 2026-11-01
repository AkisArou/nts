/*---
description: A Int32Array subclass constructed from a length crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// A length-constructed subclass is written through a Int32Array parameter; node preserves conversion, view metadata and own state.
let constructions = 0;
class ContentsInt32Length extends Int32Array {
  marker: number = 17;
  reads: number = 0;
  constructor(length: number) { super(length); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(view: Int32Array, input: number, expected: number, length: number): void {
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 4);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0), true);
  view[length - 1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === length - 1 ? expected : 0), true);
  assert.sameValue(view instanceof ContentsInt32Length, true);
  assert.sameValue(view instanceof Int32Array, true);
  if (view instanceof ContentsInt32Length) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(length - 1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number, number][] = [[2147483648, -2147483648, 2], [-2147483649, 2147483647, 3], [4294967297, 1, 4]];
for (const [input, expected, length] of inputs) {
  const before = constructions;
  check(new ContentsInt32Length(length), input, expected, length);
  assert.sameValue(constructions - before, 1);
}
