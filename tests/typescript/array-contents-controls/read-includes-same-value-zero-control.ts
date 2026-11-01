/*---
description: Control for read-includes-same-value-zero; every alias uses the same mutable array element type.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown]
---*/
// Paired case: ../array-contents/read-includes-same-value-zero.ts.
// Only declared array types change; executable operations and assertions are identical.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: ArrayReadValue[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const answers: boolean[] = [], types: string[] = [];
  for (const query of [NaN, -0, 0, n, n + 1]) {
    const result = xs.includes(query); answers.push(result); types.push(typeof result);
  }
  assert.compareArray(answers, [true, true, true, false, true]);
  assert.compareArray(types, ["boolean", "boolean", "boolean", "boolean", "boolean"]);
  assert.compareArray<unknown>(xs, [n + 1, -0, NaN, text, undefined, undefined]);
  const sourceTypes: string[] = [];
  for (const i of [0, 1, 2, 3, 4, 5]) sourceTypes.push(typeof xs[i]);
  assert.compareArray(sourceTypes, ["number", "number", "number", "string", "undefined", "undefined"]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
