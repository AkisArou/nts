/*---
description: Control for read-at-negative-sparse; every alias uses the same mutable array element type.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown]
---*/
// Paired case: ../array-contents/read-at-negative-sparse.ts.
// Only declared array types change; executable operations and assertions are identical.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: ArrayReadValue[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const seen: unknown[] = [], types: string[] = [];
  for (const offset of [-1, -2, -3, -4, -5, -6, -7, 0, 3, 6]) {
    const value = xs.at(offset); seen.push(value); types.push(typeof value);
  }
  assert.compareArray(seen, [undefined, undefined, text, NaN, -0, n + 1, undefined, n + 1, text, undefined]);
  assert.compareArray(types, ["undefined", "undefined", "string", "number", "number", "number", "undefined", "number", "string", "undefined"]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
