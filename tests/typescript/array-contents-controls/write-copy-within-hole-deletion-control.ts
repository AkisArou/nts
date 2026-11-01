/*---
description: Control for write-copy-within-hole-deletion; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Paired case: ../array-contents/write-copy-within-hole-deletion.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[] = [-0, NaN, n, n + 1, n + 2, n + 3];
  const writer: (number | string | undefined)[] = xs;
  const text = "copy:" + n;
  writer[5] = text;
  writer.length = 8;
  writer[7] = undefined;
  const returned = writer.copyWithin(2, 5, 8);
  assert.sameValue<unknown>(returned, xs);
  const expected: unknown[] = [-0, NaN, text, undefined, undefined, text, undefined, undefined];
  const kinds: string[] = ["number", "number", "string", "undefined", "undefined", "string", "undefined", "undefined"];
  const own: boolean[] = [true, true, true, false, true, true, false, true];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
