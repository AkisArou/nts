/*---
description: Control for write-splice-replace; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Paired case: ../array-contents/write-splice-replace.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[] = [-0, n, NaN, n + 1];
  const writer: (number | string | undefined)[] = xs;
  const text = "splice:" + n;
  const removed = writer.splice(1, 2, text, undefined, text + "!");
  assert.sameValue(removed.length, 2);
  assert.compareArray(removed, [n, NaN]);
  for (const i of [0, 1]) {
    assert.sameValue(typeof removed[i], "number");
    assert.sameValue(Object.hasOwn(removed, i), true); assert.sameValue(i in removed, true);
  }
  const expected: unknown[] = [-0, text, undefined, text + "!", n + 1];
  const kinds: string[] = ["number", "string", "undefined", "string", "number"];
  const own: boolean[] = [true, true, true, true, true];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
