/*---
description: Control for write-length-extend; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Paired case: ../array-contents/write-length-extend.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[] = [-0, NaN, n];
  const writer: (number | string | undefined)[] = xs;
  const text = "keep:" + n;
  writer[2] = text;
  writer.length = 6;
  writer[4] = undefined;
  const expected: unknown[] = [-0, NaN, text, undefined, undefined, undefined];
  const kinds: string[] = ["number", "number", "string", "undefined", "undefined", "undefined"];
  const own: boolean[] = [true, true, true, false, true, false];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
