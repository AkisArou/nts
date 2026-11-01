/*---
description: Control for widening-interface-field; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-array, ts-interfaces, ts-objects, ts-structural-typing]
---*/
// Paired case: ../array-contents/widening-interface-field.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
interface ArrayHolder { contents: (number | string)[]; }
function check(n: number): void {
  const xs: (number | string)[] = [-0, NaN, n];
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
