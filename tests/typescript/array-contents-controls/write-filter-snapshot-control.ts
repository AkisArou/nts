/*---
description: Control for write-filter-snapshot; the source and writer use one declared element type.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined, ts-arrow-functions]
---*/
// Paired case: ../array-contents/write-filter-snapshot.ts.
// Only the source declaration is widened; writes, reads and expectations stay identical.
function check(n: number): void {
  const xs: (number | string | undefined)[] = [-0, n, NaN];
  const writer: (number | string | undefined)[] = xs;
  const text = "copy:" + n;
  writer.length = 6;
  writer[3] = text;
  writer[4] = undefined;
  const visited: number[] = [], received: unknown[] = [];
  const copy = xs.filter((value, index) => { visited.push(index); received.push(value); return index !== 1; });
  assert.compareArray(visited, [0, 1, 2, 3, 4]);
  assert.compareArray(received, [-0, n, NaN, text, undefined]);
  writer[3] = "changed:" + n;
  writer.length = 2;
  assert.sameValue(xs.length, 2);
  const expected: unknown[] = [-0, NaN, text, undefined];
  const kinds: string[] = ["number", "number", "string", "undefined"];
  const own: boolean[] = [true, true, true, true];
  assert.sameValue(copy.length, expected.length);
  for (let i = 0; i < copy.length; i++) {
    assert.sameValue<unknown>(copy[i], expected[i]);
    assert.sameValue(typeof copy[i], kinds[i]);
    assert.sameValue(Object.hasOwn(copy, i), own[i]);
    assert.sameValue(i in copy, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
