/*---
description: A BigInt64Array subclass constructed from a iterable crosses a base-typed parameter for exact content writes and reads.
features: [ts-typed-array-contents, ts-typed-array-subclasses, ts-arrays, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-functions, ts-iteration, ts-bigint, ts-map-set]
---*/
// A iterable-constructed subclass is written through a BigInt64Array parameter; node preserves conversion, view metadata and own state.
let constructions = 0;
class ContentsBigInt64Iterable extends BigInt64Array {
  marker: number = 17;
  reads: number = 0;
  constructor(values: Iterable<bigint>) { super(values); constructions++; }
  sample(index: number): bigint { this.reads++; return this[index]; }
}
function check(view: BigInt64Array, input: bigint, expected: bigint): void {
  const length = 3;
  const initialFirst = expected;
  assert.sameValue(view.length, length);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, length * 8);
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? 2n : 3n), true);
  view[1] = input;
  for (let i = 0; i < length; i++) assert.sameValue(Object.is(view[i], i === 0 ? initialFirst : i === 1 ? expected : 3n), true);
  assert.sameValue(view instanceof ContentsBigInt64Iterable, true);
  assert.sameValue(view instanceof BigInt64Array, true);
  if (view instanceof ContentsBigInt64Iterable) {
    assert.sameValue(view.marker, 17);
    assert.sameValue(Object.is(view.sample(1), expected), true);
    assert.sameValue(view.reads, 1);
  }
}
const inputs: [bigint, bigint][] = [[9223372036854775808n, -9223372036854775808n], [-9223372036854775809n, 9223372036854775807n], [18446744073709551617n, 1n]];
for (const [input, expected] of inputs) {
  const before = constructions;
  check(new ContentsBigInt64Iterable(new Set<bigint>([input, 2n, 3n])), input, expected);
  assert.sameValue(constructions - before, 1);
}
