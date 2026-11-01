/*---
description: for-of traverses every position of a union-mutated numeric array while retaining hole and undefined distinctions.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown]
---*/
// Write through a union alias; read through for-of on the narrow array; node preserves actual values and sparse-slot behavior.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: number[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const seen: unknown[] = [], types: string[] = [], indices: number[] = [], owns: boolean[] = [], present: boolean[] = [];
  let index = 0;
  for (const value of xs) {
    seen.push(value); types.push(typeof value); indices.push(index);
    owns.push(Object.hasOwn(xs, index)); present.push(index in xs);
    index++;
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
