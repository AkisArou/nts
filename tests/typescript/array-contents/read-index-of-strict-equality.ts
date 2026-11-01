/*---
description: indexOf distinguishes a string written through a union alias from its numeric twin and observes NaN and zero equality.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown]
---*/
// Write through a union alias; read with indexOf through the original numeric array type; node preserves actual values and sparse-slot behavior.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: number[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const answers: number[] = [], types: string[] = [];
  for (const query of [NaN, -0, 0, n, n + 1]) {
    const result = xs.indexOf(query); answers.push(result); types.push(typeof result);
  }
  assert.compareArray(answers, [-1, 1, 1, -1, 0]);
  assert.compareArray(types, ["number", "number", "number", "number", "number"]);
  assert.compareArray<unknown>(xs, [n + 1, -0, NaN, text, undefined, undefined]);
  const sourceTypes: string[] = [];
  for (const i of [0, 1, 2, 3, 4, 5]) sourceTypes.push(typeof xs[i]);
  assert.compareArray(sourceTypes, ["number", "number", "number", "string", "undefined", "undefined"]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
