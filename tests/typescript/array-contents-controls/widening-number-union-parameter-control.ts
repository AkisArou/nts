/*---
description: Control for widening-number-union-parameter; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-array]
---*/
// Paired case: ../array-contents/widening-number-union-parameter.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function writeArray(xs: (number | string)[], text: string): void {
  xs[1] = text;
  xs.push(text + "!");
}
function check(n: number): void {
  const xs: (number | string)[] = [n, -0, NaN];
  const text = "value:" + String(n);
  writeArray(xs, text);
  assert.sameValue<unknown>(xs[1], text);
  assert.sameValue(typeof xs[1], "string");
  assert.sameValue(xs[0], n);
  assert.sameValue(xs[2], NaN);
  assert.sameValue(xs.length, 4);
  assert.compareArray<unknown>(xs, [n, text, NaN, text + "!"]);
  assert.compareArray(xs.map(value => typeof value), ["number", "string", "number", "string"]);
  assert.sameValue(Object.hasOwn(xs, 1), true);
  assert.sameValue(1 in xs, true);
}
for (const n of [-0, NaN, 2147483649]) check(n);
