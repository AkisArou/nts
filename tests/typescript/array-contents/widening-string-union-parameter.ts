/*---
description: A union-typed parameter writes numbers into a string array without converting NaN or negative zero.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-array]
---*/
// Write through a (string | number)[] parameter; read through the original string[]; node preserves the actual elements, order and length.
function writeArray(xs: (string | number)[], value: number): void {
  xs[1] = value;
  xs.push(-0);
}
function check(n: number): void {
  const text = "keep:" + String(n);
  const xs: string[] = [text, "replace"];
  writeArray(xs, n);
  assert.sameValue<unknown>(xs[1], n);
  assert.sameValue(typeof xs[1], "number");
  assert.sameValue<unknown>(xs[2], -0);
  assert.sameValue(typeof xs[2], "number");
  assert.sameValue(xs.length, 3);
  assert.compareArray<unknown>(xs, [text, n, -0]);
  assert.compareArray(xs.map(value => typeof value), ["string", "number", "number"]);
  assert.sameValue(Object.hasOwn(xs, 1), true);
  assert.sameValue(1 in xs, true);
}
for (const n of [-0, NaN, 2147483649]) check(n);
