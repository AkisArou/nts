/*---
description: Control for read-index-sparse-and-outside; every alias uses the same mutable array element type.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown]
---*/
// Paired case: ../array-contents/read-index-sparse-and-outside.ts.
// Only declared array types change; executable operations and assertions are identical.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: ArrayReadValue[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const seen: unknown[] = [], types: string[] = [], owns: boolean[] = [], present: boolean[] = [];
  for (const i of [0, 1, 2, 3, 4, 5, 6, 9, -1]) {
    const value = xs[i];
    seen.push(value); types.push(typeof value); owns.push(Object.hasOwn(xs, i)); present.push(i in xs);
  }
  assert.compareArray(seen, [n + 1, -0, NaN, text, undefined, undefined, undefined, undefined, undefined]);
  assert.compareArray(types, ["number", "number", "number", "string", "undefined", "undefined", "undefined", "undefined", "undefined"]);
  assert.compareArray(owns, [true, true, true, true, false, true, false, false, false]);
  assert.compareArray(present, [true, true, true, true, false, true, false, false, false]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
