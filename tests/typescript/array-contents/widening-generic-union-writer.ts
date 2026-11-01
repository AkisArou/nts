/*---
description: An explicit generic union writer repeatedly changes a numeric array slot between strings and numbers.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-generic-widening]
---*/
// Write through a generic number|string instantiation; read the original number[] after every write; node preserves the actual elements, order and length.
function writeArray<T>(xs: T[], value: T): void { xs[1] = value; }
function check(n: number): void {
  const xs: number[] = [-0, n, NaN];
  for (const expected of ["first:" + String(n), n, "last:" + String(n)]) {
    writeArray<number | string>(xs, expected);
    assert.sameValue<unknown>(xs[1], expected);
    assert.sameValue(typeof xs[1], typeof expected);
    assert.sameValue(xs.length, 3);
    assert.compareArray<unknown>(xs, [-0, expected, NaN]);
    assert.compareArray(xs.map(value => typeof value), ["number", typeof expected, "number"]);
  }
}
for (const n of [-0, NaN, 2147483649]) check(n);
