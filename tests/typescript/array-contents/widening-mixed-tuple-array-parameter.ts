/*---
description: A mixed numeric and boolean tuple widened to an array retains string replacements and an appended boolean.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-tuples, ts-unions, ts-strings, ts-arrow-functions, ts-unsound-covariant-array]
---*/
// Write through a number|boolean|string array parameter; read the original mixed tuple; node preserves the actual elements, order and length.
function writeArray(xs: (number | boolean | string)[], text: string): void {
  xs[0] = text;
  xs[1] = text + "!";
  xs.push(true);
}
function check(n: number): void {
  const xs: [number, boolean] = [n, false];
  const text = "tuple:" + String(n);
  writeArray(xs, text);
  assert.sameValue<unknown>(xs[0], text);
  assert.sameValue(typeof xs[0], "string");
  assert.sameValue<unknown>(xs[1], text + "!");
  assert.sameValue(typeof xs[1], "string");
  assert.sameValue(xs.length, 3);
  assert.compareArray<unknown>(xs, [text, text + "!", true]);
  assert.compareArray(xs.map(value => typeof value), ["string", "string", "boolean"]);
  assert.sameValue(Object.hasOwn(xs, 2), true);
  assert.sameValue(2 in xs, true);
}
for (const n of [-2, 0, 7]) check(n);
