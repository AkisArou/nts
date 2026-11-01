/*---
description: Control for write-index-within-length; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown]
---*/
// Paired case: ../array-contents/write-index-within-length.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string)[] = [-0, n, NaN];
  const writer: (number | string)[] = xs;
  const text = "slot:" + n;
  writer[1] = text;
  const expected: unknown[] = [-0, text, NaN];
  const kinds: string[] = ["number", "string", "number"];
  const own: boolean[] = [true, true, true];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
