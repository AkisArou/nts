/*---
description: Control for subclasses-float16-length; keep the subclass view in one exact local declaration.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-numbers]
---*/
// Only the base-typed view parameter is replaced by local construction; inputs, stores and observations are identical.
let constructions = 0;
class ContentsFloat16Length extends Float16Array {
  marker: number = 17;
  reads: number = 0;
  constructor(length: number) { super(length); constructions++; }
  sample(index: number): number { this.reads++; return this[index]; }
}
function check(input: number, expected: number, length: number): void {
  const view: ContentsFloat16Length = new ContentsFloat16Length(length);
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 2);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0), true);
  view[length - 1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === length - 1 ? expected : 0), true);
  assert.sameValue(view instanceof ContentsFloat16Length, true);
  assert.sameValue(view instanceof Float16Array, true);
  if (view instanceof ContentsFloat16Length) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(length - 1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [number, number, number][] = [[0.1, 0.0999755859375, 2], [65520, Infinity, 3], [1.00048828125, 1, 4], [NaN, NaN, 5]];
for (const [input, expected, length] of inputs) {
  const before = constructions;
  check(input, expected, length);
  assert.sameValue(constructions - before, 1);
}
