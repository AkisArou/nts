/*---
description: Control for subclasses-biguint64-array; keep the subclass view in one exact local declaration.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-bigint]
---*/
// Only the base-typed view parameter is replaced by local construction; inputs, stores and observations are identical.
let constructions = 0;
class ContentsBigUint64Array extends BigUint64Array {
  marker: number = 17;
  reads: number = 0;
  constructor(values: bigint[]) { super(values); constructions++; }
  sample(index: number): bigint { this.reads++; return this[index]; }
}
function check(input: bigint, expected: bigint): void {
  const view: ContentsBigUint64Array = new ContentsBigUint64Array([input, 2n, 3n]);
  const length = 3;
  const initialFirst = expected;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 8);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? 2n : 3n), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? expected : 3n), true);
  assert.sameValue(view instanceof ContentsBigUint64Array, true);
  assert.sameValue(view instanceof BigUint64Array, true);
  if (view instanceof ContentsBigUint64Array) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [bigint, bigint][] = [[-1n, 18446744073709551615n], [18446744073709551616n, 0n], [18446744073709551617n, 1n]];
for (const [input, expected] of inputs) {
  const before = constructions;
  check(input, expected);
  assert.sameValue(constructions - before, 1);
}
