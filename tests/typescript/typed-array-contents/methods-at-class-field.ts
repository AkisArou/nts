/*---
description: At reads negative and out-of-range indices through a class field holding a Float64Array.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-null-undefined, ts-class, ts-class-fields]
---*/
// Read at through a class-held view; node translates negative indices and returns undefined beyond either end.
class MethodViewHolder {
  view: Float64Array;
  constructor(view: Float64Array) { this.view = view; }
}
function check(holder: MethodViewHolder, n: number): void {
  const view = holder.view;
  view.set([NaN, -0, n, 0, n + 1]);
  const indices = [-6, -5, -4, -1, 0, 4, 5];
  const answers = [undefined, NaN, -0, n + 1, NaN, n + 1, undefined];
  for (let i = 0; i < indices.length; i++) assert.sameValue(Object.is(view.at(indices[i]), answers[i]), true);
  const expected = [NaN, -0, n, 0, n + 1];
  assert.sameValue(view.length, 5);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 40);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [2, 9, 2147483649]) check(new MethodViewHolder(new Float64Array(new ArrayBuffer(56), 8, 5)), n);
