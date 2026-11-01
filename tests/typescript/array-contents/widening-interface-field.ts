/*---
description: A widened interface field writes strings read through the original numeric array holder.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-array, ts-interfaces, ts-objects, ts-structural-typing]
---*/
// Write through a widened interface field; read through the original narrow holder; node preserves the actual elements, order and length.
interface ArrayHolder { contents: number[]; }
function check(n: number): void {
  const xs: number[] = [-0, NaN, n];
  const holder: ArrayHolder = { contents: xs };
  const writer: { contents: (number | string)[] } = holder;
  const text = "item:" + String(n);
  writer.contents[2] = text;
  writer.contents.push(text + "!");
  const result = holder.contents;
  assert.sameValue<unknown>(result, xs);
  assert.sameValue<unknown>(result[2], text);
  assert.sameValue(typeof result[2], "string");
  assert.sameValue(result.length, 4);
  assert.compareArray<unknown>(result, [-0, NaN, text, text + "!"]);
  assert.compareArray(result.map(value => typeof value), ["number", "number", "string", "string"]);
}
for (const n of [-2, 0, 7]) check(n);
