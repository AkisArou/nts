/*---
description: unshift through a widened alias inserts string and undefined elements while retaining the numeric payloads.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Write with union-typed unshift; read the numeric array; node returns length five with exact mixed contents.
function check(n: number): void {
  const xs: number[] = [-0, NaN, n];
  const writer: (number | string | undefined)[] = xs;
  const text = "item:" + n;
  const length = writer.unshift(text, undefined);
  assert.sameValue(length, 5);
  const expected: unknown[] = [text, undefined, -0, NaN, n];
  const kinds: string[] = ["string", "undefined", "number", "number", "number"];
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
