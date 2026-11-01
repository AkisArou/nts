/*---
description: Extending length through a widened alias creates absent slots around an explicitly stored undefined element.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Write length up through a union alias, then store undefined; read numeric slots; node leaves the other new indices as holes.
function check(n: number): void {
  const xs: number[] = [-0, NaN, n];
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
