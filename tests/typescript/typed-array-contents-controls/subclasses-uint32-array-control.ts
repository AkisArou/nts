/*---
description: Control for subclasses-uint32-array; keep the subclass view in one exact local declaration.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// Only the base-typed view parameter is replaced by local construction; inputs, stores and observations are identical.
let constructions = 0;
class ContentsUint32Array extends Uint32Array {
  marker: number = 17;
  reads: number = 0;
  constructor(values: number[]) { super(values); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(input: number, expected: number): void {
  const view: ContentsUint32Array = new ContentsUint32Array([input, 2, 3]);
  const length = 3;
  const initialFirst = expected;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 4);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? 2 : 3), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? expected : 3), true);
  assert.sameValue(view instanceof ContentsUint32Array, true);
  assert.sameValue(view instanceof Uint32Array, true);
  if (view instanceof ContentsUint32Array) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number][] = [[2147483648, 2147483648], [4294967296, 0], [-1, 4294967295]];
for (const [input, expected] of inputs) {
  const before = constructions;
  check(input, expected);
  assert.sameValue(constructions - before, 1);
}
