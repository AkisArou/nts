/*---
description: A widened array element writes strings read through the original numeric array holder.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-array]
---*/
// Write through a widened array element; read through the original narrow holder; node preserves the actual elements, order and length.
function check(n: number): void {
  const xs: number[] = [-0, NaN, n];
  const holder: number[][] = [xs];
  const writer: (number | string)[][] = holder;
  const text = "item:" + String(n);
  writer[0][2] = text;
  writer[0].push(text + "!");
  const result = holder[0];
  assert.sameValue<unknown>(result, xs);
  assert.sameValue<unknown>(result[2], text);
  assert.sameValue(typeof result[2], "string");
  assert.sameValue(result.length, 4);
  assert.compareArray<unknown>(result, [-0, NaN, text, text + "!"]);
  assert.compareArray(result.map(value => typeof value), ["number", "number", "string", "string"]);
}
for (const n of [-2, 0, 7]) check(n);
