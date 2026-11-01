/*---
description: Control for write-length-truncate; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Paired case: ../array-contents/write-length-truncate.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[] = [-0, n, NaN, n + 1];
  const writer: (number | string | undefined)[] = xs;
  const text = "keep:" + n;
  writer[1] = text;
  writer[3] = undefined;
  writer.length = 2;
  for (const i of [2, 3]) {
    assert.sameValue<unknown>(xs[i], undefined); assert.sameValue(typeof xs[i], "undefined");
    assert.sameValue(Object.hasOwn(xs, i), false); assert.sameValue(i in xs, false);
  }
  const expected: unknown[] = [-0, text];
  const kinds: string[] = ["number", "string"];
  const own: boolean[] = [true, true];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
