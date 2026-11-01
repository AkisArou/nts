/*---
description: Control for widening-mixed-tuple-array-parameter; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-tuples, ts-unions, ts-strings, ts-arrow-functions, ts-unsound-covariant-array]
---*/
// Paired case: ../array-contents/widening-mixed-tuple-array-parameter.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function writeArray(xs: (number | boolean | string)[], text: string): void {
  xs[0] = text;
  xs[1] = text + "!";
  xs.push(true);
}
function check(n: number): void {
  const xs: (number | boolean | string)[] = [n, false];
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
