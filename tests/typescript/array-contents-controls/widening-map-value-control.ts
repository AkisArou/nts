/*---
description: Control for widening-map-value; one declared element type across the write and read route.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-numbers, ts-strings, ts-arrow-functions, ts-unsound-covariant-array, ts-map-set, ts-narrowing]
---*/
// Paired case: ../array-contents/widening-map-value.ts.
// Only array and generic declarations change; executable operations and assertions are identical.
function check(n: number): void {
  const xs: (number | string)[] = [-0, NaN, n];
  const holder = new Map<string, (number | string)[]>([["slot", xs]]);
  const writer: Map<string, (number | string)[]> = holder;
  const target = writer.get("slot");
  if (target === undefined) throw new Error("Missing writer array");
  const text = "item:" + String(n);
  target[2] = text;
  target.push(text + "!");
  const result = holder.get("slot");
  if (result === undefined) throw new Error("Missing reader array");
  assert.sameValue<unknown>(result, xs);
  assert.sameValue<unknown>(result[2], text);
  assert.sameValue(typeof result[2], "string");
  assert.sameValue(result.length, 4);
  assert.compareArray<unknown>(result, [-0, NaN, text, text + "!"]);
  assert.compareArray(result.map(value => typeof value), ["number", "number", "string", "string"]);
}
for (const n of [-2, 0, 7]) check(n);
