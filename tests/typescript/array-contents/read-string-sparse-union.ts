/*---
description: String observes mixed values and sparse positions through a numeric array after union writes.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-conversions, ts-to-string]
---*/
// Write through a union alias; read with String from the original numeric array; node preserves actual values and sparse-slot behavior.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = "value:" + n;
  const xs: number[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const result = String(xs);
  assert.sameValue(result, String(n + 1) + ",0,NaN," + text + ",,");
  assert.sameValue(typeof result, "string");
  assert.compareArray<unknown>(xs, [n + 1, -0, NaN, text, undefined, undefined]);
  const sourceTypes: string[] = [];
  for (const i of [0, 1, 2, 3, 4, 5]) sourceTypes.push(typeof xs[i]);
  assert.compareArray(sourceTypes, ["number", "number", "number", "string", "undefined", "undefined"]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
