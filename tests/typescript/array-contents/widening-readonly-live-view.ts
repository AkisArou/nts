/*---
description: A retained readonly numeric view observes string-number-string replacement through a mutable union alias.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-view]
---*/
// Write through a mutable union alias; read a retained readonly number[] view after each write; node preserves the actual elements, order and length.
function check(n: number): void {
  const xs: number[] = [-0, NaN, n];
  const view: readonly number[] = xs;
  const writer: (number | string)[] = xs;
  for (const expected of ["first:" + String(n), n, "last:" + String(n)]) {
    writer[2] = expected;
    assert.sameValue<unknown>(view, xs);
    assert.sameValue<unknown>(view[2], expected);
    assert.sameValue(typeof view[2], typeof expected);
    assert.sameValue(view[0], -0);
    assert.sameValue(view[1], NaN);
    assert.sameValue(view.length, 3);
    assert.compareArray<unknown>(view, [-0, NaN, expected]);
    assert.compareArray(view.map(value => typeof value), ["number", "number", typeof expected]);
  }
}
for (const n of [-2, 0, 7]) check(n);
