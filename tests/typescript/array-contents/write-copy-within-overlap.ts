/*---
description: Overlapping copyWithin preserves mixed values while copying through a wider alias of a numeric array.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Write through an overlapping union-typed copyWithin; read numeric slots; node copies from the end so the original source values survive.
function check(n: number): void {
  const xs: number[] = [-0, NaN, n, n + 1, n + 2, n + 3];
  const writer: (number | string | undefined)[] = xs;
  const text = "copy:" + n;
  writer[2] = text;
  writer.length = 8;
  writer[6] = undefined;
  const returned = writer.copyWithin(3, 2, 7);
  assert.sameValue<unknown>(returned, xs);
  const expected: unknown[] = [-0, NaN, text, text, n + 1, n + 2, n + 3, undefined];
  const kinds: string[] = ["number", "number", "string", "string", "number", "number", "number", "undefined"];
  const own: boolean[] = [true, true, true, true, true, true, true, true];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
