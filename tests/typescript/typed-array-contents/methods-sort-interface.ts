/*---
description: Default sort on an interface-held Float64Array is numeric and orders negative zero before positive zero and NaN last.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-interfaces]
---*/
// Sort a view reached through an interface field; node orders numeric values, signed zeros and NaN without changing the view window.
interface MethodViewHolder { view: Float64Array; }
function check(holder: MethodViewHolder, n: number): void {
  const view = holder.view;
  view.set([NaN, 10 + n, 0, -0, 2 + n, -Infinity]);
  const returned = view.sort();
  assert.sameValue(returned, view);
  const expected = [-Infinity, -0, 0, 2 + n, 10 + n, NaN];
  assert.sameValue(view.length, 6);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 48);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
}
for (const n of [-1, 0, 3]) check({ view: new Float64Array(new ArrayBuffer(64), 8, 6) }, n);
