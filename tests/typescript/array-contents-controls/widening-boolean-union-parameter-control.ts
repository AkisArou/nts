/*---
description: Control for widening-boolean-union-parameter; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-strings, ts-arrow-functions, ts-unsound-covariant-array]
---*/
// Paired case: ../array-contents/widening-boolean-union-parameter.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function writeArray(xs: (boolean | string)[], text: string): void {
  xs[0] = text;
  xs.push(text + "!");
}
function check(n: number): void {
  const flag = n >= 0;
  const xs: (boolean | string)[] = [flag, !flag];
  const text = "flag:" + String(n);
  writeArray(xs, text);
  assert.sameValue<unknown>(xs[0], text);
  assert.sameValue(typeof xs[0], "string");
  assert.sameValue(xs[1], !flag);
  assert.sameValue(typeof xs[1], "boolean");
  assert.sameValue(xs.length, 3);
  assert.compareArray<unknown>(xs, [text, !flag, text + "!"]);
  assert.compareArray(xs.map(value => typeof value), ["string", "boolean", "string"]);
  assert.sameValue(Object.hasOwn(xs, 0), true);
  assert.sameValue(0 in xs, true);
}
for (const n of [-3, 0, 8]) check(n);
