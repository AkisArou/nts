/*---
description: Control for widening-readonly-live-view; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-view]
---*/
// Paired case: ../array-contents/widening-readonly-live-view.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function check(n: number): void {
  const xs: (number | string)[] = [-0, NaN, n];
  const view: (number | string)[] = xs;
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
