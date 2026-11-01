/*---
description: Control for write-sort-comparator-mixed; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined, ts-arrow-functions, ts-narrowing]
---*/
// Paired case: ../array-contents/write-sort-comparator-mixed.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[] = [n + 10, n, -0, NaN];
  const writer: (number | string | undefined)[] = xs;
  const text = "first:" + n;
  writer.push(text, undefined);
  writer.length = 7;
  let comparisons = 0;
  const returned = writer.sort((left, right) => {
    comparisons++;
    if (typeof left === "string") return typeof right === "string" ? 0 : -1;
    if (typeof right === "string") return 1;
    if (left === undefined) return right === undefined ? 0 : 1;
    if (right === undefined) return -1;
    if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : 1;
    if (Number.isNaN(right)) return -1;
    return left - right;
  });
  assert.sameValue(comparisons > 0, true);
  assert.sameValue<unknown>(returned, xs);
  const expected: unknown[] = [text, -0, n, n + 10, NaN, undefined, undefined];
  const kinds: string[] = ["string", "number", "number", "number", "number", "undefined", "undefined"];
  const own: boolean[] = [true, true, true, true, true, true, false];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
