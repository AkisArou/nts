/*---
description: Control for widening-class-field; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-array, ts-class, ts-class-fields, ts-objects, ts-structural-typing]
---*/
// Paired case: ../array-contents/widening-class-field.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
class ArrayHolder {
  contents: (number | string)[];
  constructor(contents: (number | string)[]) { this.contents = contents; }
}
function check(n: number): void {
  const xs: (number | string)[] = [-0, NaN, n];
  const holder = new ArrayHolder(xs);
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
