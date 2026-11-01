/*---
description: A numeric tuple widened to a union array accepts a string replacement and grows beyond its declared tuple length.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-tuples, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-array]
---*/
// Write through a union array parameter; read the original homogeneous numeric tuple; node preserves the actual elements, order and length.
function writeArray(xs: (number | string)[], text: string): void {
  xs[0] = text;
  xs.push(text + "!");
}
function check(n: number): void {
  const xs: [number, number] = [-0, n];
  const text = "tuple:" + String(n);
  writeArray(xs, text);
  assert.sameValue<unknown>(xs[0], text);
  assert.sameValue(typeof xs[0], "string");
  assert.sameValue(xs[1], n);
  assert.sameValue(typeof xs[1], "number");
  assert.sameValue(xs.length, 3);
  assert.compareArray<unknown>(xs, [text, n, text + "!"]);
  assert.compareArray(xs.map(value => typeof value), ["string", "number", "string"]);
  assert.sameValue(Object.hasOwn(xs, 2), true);
  assert.sameValue(2 in xs, true);
}
for (const n of [-0, NaN, 2147483649]) check(n);
