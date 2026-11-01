/*---
description: Control for read-destructuring-defaults-sparse; every alias uses the same mutable array element type.
features: [ts-array-contents, ts-array-reads, ts-arrays, ts-functions, ts-iteration, ts-unions, ts-type-aliases, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-expressions, ts-unknown, ts-destructuring]
---*/
// Paired case: ../array-contents/read-destructuring-defaults-sparse.ts.
// Only declared array types change; executable operations and assertions are identical.
type ArrayReadValue = number | string | undefined;
function check(n: number): void {
  const text = String(n);
  const xs: ArrayReadValue[] = [n + 1, -0, NaN];
  const writer: ArrayReadValue[] = xs;
  writer[3] = text; writer.length = 6; writer[5] = undefined;
  const [first, zero, nan, value, hole = "hole:" + n, stored = "stored:" + n, past = "past:" + n] = xs;
  assert.compareArray<unknown>([first, zero, nan, value, hole, stored, past], [n + 1, -0, NaN, text, "hole:" + n, "stored:" + n, "past:" + n]);
  assert.compareArray([typeof first, typeof zero, typeof nan, typeof value, typeof hole, typeof stored, typeof past], ["number", "number", "number", "string", "string", "string", "string"]);
  assert.sameValue(xs.length, 6);
  assert.sameValue(Object.hasOwn(xs, 4), false); assert.sameValue(4 in xs, false);
  assert.sameValue(Object.hasOwn(xs, 5), true); assert.sameValue(5 in xs, true);
}
for (const n of [2, 9, 40]) check(n);
