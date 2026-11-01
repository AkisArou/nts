/*---
description: Control for write-concat-snapshot; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Paired case: ../array-contents/write-concat-snapshot.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[] = [-0, n, NaN];
  const writer: (number | string | undefined)[] = xs;
  const text = "copy:" + n;
  writer.length = 6;
  writer[3] = text;
  writer[4] = undefined;
  const copy = xs.concat([n + 1]);
  writer[3] = "changed:" + n;
  writer.length = 2;
  assert.sameValue(xs.length, 2);
  const expected: unknown[] = [-0, n, NaN, text, undefined, undefined, n + 1];
  const kinds: string[] = ["number", "number", "number", "string", "undefined", "undefined", "number"];
  const own: boolean[] = [true, true, true, true, true, false, true];
  assert.sameValue(copy.length, expected.length);
  for (let i = 0; i < copy.length; i++) {
    assert.sameValue<unknown>(copy[i], expected[i]);
    assert.sameValue(typeof copy[i], kinds[i]);
    assert.sameValue(Object.hasOwn(copy, i), own[i]);
    assert.sameValue(i in copy, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
