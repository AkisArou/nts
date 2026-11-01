/*---
description: An index write past the length creates a hole distinct from a stored undefined element through a widened writer.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Write through a union alias past the length; read numeric slots; node creates only the skipped hole and preserves explicit undefined.
function check(n: number): void {
  const xs: number[] = [-0, NaN, n];
  const writer: (number | string | undefined)[] = xs;
  const text = "past:" + n;
  writer[5] = text;
  writer[4] = undefined;
  const expected: unknown[] = [-0, NaN, n, undefined, undefined, text];
  const kinds: string[] = ["number", "number", "number", "undefined", "undefined", "string"];
  const own: boolean[] = [true, true, true, false, true, true];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
