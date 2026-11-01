/*---
description: Control for write-flat-sparse-nested; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Paired case: ../array-contents/write-flat-sparse-nested.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[][] = [[-0, n], [NaN, n + 1]];
  const writer: (number | string | undefined)[][] = xs;
  const text = "flat:" + n;
  writer[1][1] = text;
  writer[1].length = 4;
  writer[1][3] = undefined;
  writer.length = 3;
  assert.sameValue(Object.hasOwn(xs, 2), false); assert.sameValue(2 in xs, false);
  assert.sameValue(Object.hasOwn(xs[1], 2), false); assert.sameValue(2 in xs[1], false);
  assert.sameValue(Object.hasOwn(xs[1], 3), true); assert.sameValue(3 in xs[1], true);
  const copy = xs.flat();
  writer[1][1] = "changed:" + n;
  writer[0][1] = n + 100;
  const expected: unknown[] = [-0, n, NaN, text, undefined];
  const kinds: string[] = ["number", "number", "number", "string", "undefined"];
  const own: boolean[] = [true, true, true, true, true];
  assert.sameValue(copy.length, expected.length);
  for (let i = 0; i < copy.length; i++) {
    assert.sameValue<unknown>(copy[i], expected[i]);
    assert.sameValue(typeof copy[i], kinds[i]);
    assert.sameValue(Object.hasOwn(copy, i), own[i]);
    assert.sameValue(i in copy, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
