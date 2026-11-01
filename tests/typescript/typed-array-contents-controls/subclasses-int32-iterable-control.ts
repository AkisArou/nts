/*---
description: Control for subclasses-int32-iterable; keep the subclass view in one exact local declaration.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers, ts-map-set]
---*/
// Only the base-typed view parameter is replaced by local construction; inputs, stores and observations are identical.
let constructions = 0;
class ContentsInt32Iterable extends Int32Array {
  marker: number = 17;
  reads: number = 0;
  constructor(values: Iterable<number>) { super(values); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(input: number, expected: number): void {
  const view: ContentsInt32Iterable = new ContentsInt32Iterable(new Set<number>([input, 2, 3]));
  const length = 3;
  const initialFirst = Object.is(input, -0) ? 0 : expected;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 4);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? 2 : 3), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? expected : 3), true);
  assert.sameValue(view instanceof ContentsInt32Iterable, true);
  assert.sameValue(view instanceof Int32Array, true);
  if (view instanceof ContentsInt32Iterable) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number][] = [[2147483648, -2147483648], [-2147483649, 2147483647], [4294967297, 1]];
for (const [input, expected] of inputs) {
  const before = constructions;
  check(input, expected);
  assert.sameValue(constructions - before, 1);
}
