/*---
description: A widened fill writes strings into occupied slots and holes while leaving an unfilled hole absent.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Write a string with union-typed fill across existing and absent slots; read the numeric array; node preserves -0, NaN and the outside hole.
function check(n: number): void {
  const xs: number[] = [-0, NaN, n];
  const writer: (number | string | undefined)[] = xs;
  const text = "fill:" + n;
  writer.length = 6;
  const returned = writer.fill(text, 2, 5);
  assert.sameValue<unknown>(returned, xs);
  const expected: unknown[] = [-0, NaN, text, text, text, undefined];
  const kinds: string[] = ["number", "number", "string", "string", "string", "undefined"];
  const own: boolean[] = [true, true, true, true, true, false];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
