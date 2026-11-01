/*---
description: An unknown writer changes a numeric slot repeatedly and keeps a hole distinct from stored undefined.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-null-undefined, ts-unsound-covariant-array]
---*/
// Write through unknown[]; read the original number[] including hole and own-index presence; node preserves the actual elements, order and length.
function check(n: number): void {
  const xs: number[] = [n, -0, NaN];
  const writer: unknown[] = xs;
  writer.length = 5;
  writer[4] = undefined;
  for (const expected of ["value:" + String(n), undefined, n]) {
    writer[1] = expected;
    assert.sameValue<unknown>(xs[1], expected);
    assert.sameValue(typeof xs[1], typeof expected);
    assert.sameValue(xs.length, 5);
    assert.compareArray<unknown>(xs, [n, expected, NaN, undefined, undefined]);
    assert.compareArray([typeof xs[0], typeof xs[1], typeof xs[2], typeof xs[3], typeof xs[4]],
      ["number", typeof expected, "number", "undefined", "undefined"]);
    assert.sameValue(Object.hasOwn(xs, 3), false);
    assert.sameValue(3 in xs, false);
    assert.sameValue(Object.hasOwn(xs, 4), true);
    assert.sameValue(4 in xs, true);
  }
}
for (const n of [-0, NaN, 2147483649]) check(n);
