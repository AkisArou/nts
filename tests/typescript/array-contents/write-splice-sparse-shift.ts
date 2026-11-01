/*---
description: A widened splice preserves holes and stored undefined separately in both the removed segment and shifted tail.
features: [ts-array-contents, ts-array-writes, ts-arrays, ts-unions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-expressions, ts-unsound-covariant-array, ts-unknown, ts-null-undefined]
---*/
// Write with splice through a union alias over sparse numeric storage; node keeps holes absent while shifting the tail and returning removed slots.
function check(n: number): void {
  const xs: number[] = [-0, n];
  const writer: (number | string | undefined)[] = xs;
  const text = "splice:" + n;
  writer.length = 5;
  writer[3] = undefined;
  const removed = writer.splice(1, 3, text);
  assert.sameValue(removed.length, 3);
  assert.compareArray(removed, [n, undefined, undefined]);
  for (const i of [0, 1, 2]) {
    assert.sameValue(typeof removed[i], i === 0 ? "number" : "undefined");
    assert.sameValue(Object.hasOwn(removed, i), i !== 1); assert.sameValue(i in removed, i !== 1);
  }
  const expected: unknown[] = [-0, text, undefined];
  const kinds: string[] = ["number", "string", "undefined"];
  const own: boolean[] = [true, true, false];
  assert.sameValue(xs.length, expected.length);
  for (let i = 0; i < xs.length; i++) {
    assert.sameValue<unknown>(xs[i], expected[i]);
    assert.sameValue(typeof xs[i], kinds[i]);
    assert.sameValue(Object.hasOwn(xs, i), own[i]);
    assert.sameValue(i in xs, own[i]);
  }
}
for (const n of [2, 9, 2147483649]) check(n);
