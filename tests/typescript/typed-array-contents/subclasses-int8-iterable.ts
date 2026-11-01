/*---
description: A Int8Array subclass constructed from a iterable crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers, ts-map-set]
---*/
// A iterable-constructed subclass is written through a Int8Array parameter; node preserves conversion, view metadata and own state.
let constructions = 0;
class ContentsInt8Iterable extends Int8Array {
  marker: number = 17;
  reads: number = 0;
  constructor(values: Iterable<number>) { super(values); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(view: Int8Array, input: number, expected: number): void {
  const length = 3;
  const initialFirst = Object.is(input, -0) ? 0 : expected;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 1);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? 2 : 3), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? expected : 3), true);
  assert.sameValue(view instanceof ContentsInt8Iterable, true);
  assert.sameValue(view instanceof Int8Array, true);
  if (view instanceof ContentsInt8Iterable) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number][] = [[128, -128], [-129, 127], [NaN, 0]];
for (const [input, expected] of inputs) {
  const before = constructions;
  check(new ContentsInt8Iterable(new Set<number>([input, 2, 3])), input, expected);
  assert.sameValue(constructions - before, 1);
}
