/*---
description: Control for write-sort-default-mixed; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Paired case: ../array-contents/write-sort-default-mixed.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[] = [n, n + 10, -0, NaN];
  const writer: (number | string | undefined)[] = xs;
  const text = String(n + 1);
  writer.push(text, undefined);
  writer.length = 7;
  const returned = writer.sort();
  assert.sameValue<unknown>(returned, xs);
  const expected: unknown[] = [-0, n + 10, n, text, NaN, undefined, undefined];
  const kinds: string[] = ["number", "number", "number", "string", "number", "undefined", "undefined"];
  const own: boolean[] = [true, true, true, true, true, true, false];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 3, 4]) check(n);
