/*---
description: A Float32Array subclass constructed from a iterable crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers, ts-map-set]
---*/
// A iterable-constructed subclass is written through a Float32Array parameter; node preserves conversion, view metadata and own state.
let constructions = 0;
class ContentsFloat32Iterable extends Float32Array {
  marker: number = 17;
  reads: number = 0;
  constructor(values: Iterable<number>) { super(values); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(view: Float32Array, input: number, expected: number): void {
  const length = 3;
  const initialFirst = Object.is(input, -0) ? 0 : expected;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 4);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? 2 : 3), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? expected : 3), true);
  assert.sameValue(view instanceof ContentsFloat32Iterable, true);
  assert.sameValue(view instanceof Float32Array, true);
  if (view instanceof ContentsFloat32Iterable) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number][] = [[0.1, 0.10000000149011612], [1e40, Infinity], [NaN, NaN]];
for (const [input, expected] of inputs) {
  const before = constructions;
  check(new ContentsFloat32Iterable(new Set<number>([input, 2, 3])), input, expected);
  assert.sameValue(constructions - before, 1);
}
