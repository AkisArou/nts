/*---
description: Control for subclasses-bigint64-length; keep the subclass view in one exact local declaration.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-bigint]
---*/
// Only the base-typed view parameter is replaced by local construction; inputs, stores and observations are identical.
let constructions = 0;
class ContentsBigInt64Length extends BigInt64Array {
  marker: number = 17;
  reads: number = 0;
  constructor(length: number) { super(length); constructions++; }
  sample(index: number): bigint { this.reads++; return this[index]; }
}
function check(input: bigint, expected: bigint, length: number): void {
  const view: ContentsBigInt64Length = new ContentsBigInt64Length(length);
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 8);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], 0n), true);
  view[length - 1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === length - 1 ? expected : 0n), true);
  assert.sameValue(view instanceof ContentsBigInt64Length, true);
  assert.sameValue(view instanceof BigInt64Array, true);
  if (view instanceof ContentsBigInt64Length) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(length - 1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [bigint, bigint, number][] = [[9223372036854775808n, -9223372036854775808n, 2], [-9223372036854775809n, 9223372036854775807n, 3], [18446744073709551617n, 1n, 4]];
for (const [input, expected, length] of inputs) {
  const before = constructions;
  check(input, expected, length);
  assert.sameValue(constructions - before, 1);
}
