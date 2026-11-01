/*---
description: A Float64Array subclass constructed from a array crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// A array-constructed subclass is written through a Float64Array parameter; node preserves conversion, view metadata and own state.
let constructions = 0;
class ContentsFloat64Array extends Float64Array {
  marker: number = 17;
  reads: number = 0;
  constructor(values: number[]) { super(values); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(view: Float64Array, input: number, expected: number): void {
  const length = 3;
  const initialFirst = expected;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 8);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? 2 : 3), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? expected : 3), true);
  assert.sameValue(view instanceof ContentsFloat64Array, true);
  assert.sameValue(view instanceof Float64Array, true);
  if (view instanceof ContentsFloat64Array) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number][] = [[-0, -0], [NaN, NaN], [9007199254740994, 9007199254740994]];
for (const [input, expected] of inputs) {
  const before = constructions;
  check(new ContentsFloat64Array([input, 2, 3]), input, expected);
  assert.sameValue(constructions - before, 1);
}
