/*---
description: Control for widening-generic-union-writer; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-generic-widening]
---*/
// Paired case: ../array-contents/widening-generic-union-writer.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function writeArray(xs: (number | string)[], value: number | string): void { xs[1] = value; }
function check(n: number): void {
  const xs: (number | string)[] = [-0, n, NaN];
  for (const expected of ["first:" + String(n), n, "last:" + String(n)]) {
    writeArray(xs, expected);
    assert.sameValue<unknown>(xs[1], expected);
    assert.sameValue(typeof xs[1], typeof expected);
    assert.sameValue(xs.length, 3);
    assert.compareArray<unknown>(xs, [-0, expected, NaN]);
    assert.compareArray(xs.map(value => typeof value), ["number", typeof expected, "number"]);
  }
}
for (const n of [-0, NaN, 2147483649]) check(n);
