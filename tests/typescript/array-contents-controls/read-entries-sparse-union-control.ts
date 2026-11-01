/*---
description: Control for read-entries-sparse-union; every alias uses the same mutable array element type.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-destructuring]
---*/
// Paired case: ../array-contents/read-entries-sparse-union.ts.
// Only declared array types change; executable operations and assertions are identical.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: ArrayReadValue[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const seen: unknown[] = [], types: string[] = [], indices: number[] = [], owns: boolean[] = [], present: boolean[] = [];
  for (const [index, value] of xs.entries()) {
    seen.push(value); types.push(typeof value); indices.push(index);
    owns.push(Object.hasOwn(xs, index)); present.push(index in xs);
  }
  assert.compareArray(seen, [n + 1, -0, NaN, text, undefined, undefined]);
  assert.compareArray(types, ["number", "number", "number", "string", "undefined", "undefined"]);
  assert.compareArray(indices, [0, 1, 2, 3, 4, 5]);
  assert.compareArray(owns, [true, true, true, true, false, true]);
  assert.compareArray(present, [true, true, true, true, false, true]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
