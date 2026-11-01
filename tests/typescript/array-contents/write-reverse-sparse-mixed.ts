/*---
description: reverse through a widened alias moves a hole separately from owned undefined while retaining every mixed payload.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Write with reverse through a union alias; read the numeric array; node moves the absent tail slot to index zero and keeps -0 at the end.
function check(n: number): void {
  const xs: number[] = [-0, n, NaN];
  const writer: (number | string | undefined)[] = xs;
  const text = "reverse:" + n;
  writer.length = 6;
  writer[3] = text;
  writer[4] = undefined;
  const returned = writer.reverse();
  assert.sameValue<unknown>(returned, xs);
  const expected: unknown[] = [undefined, undefined, text, NaN, n, -0];
  const kinds: string[] = ["undefined", "undefined", "string", "number", "number", "number"];
  const own: boolean[] = [false, true, true, true, true, true];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
