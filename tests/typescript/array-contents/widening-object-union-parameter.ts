/*---
description: A union-typed parameter writes strings into an object array while retaining object identity and a live field mutation.
features: [ts-array-contents, ts-array-widening, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-interfaces, ts-objects, ts-numbers, ts-arrow-functions, ts-narrowing, ts-unsound-covariant-array]
---*/
// Write through an (ArrayCell | string)[] parameter; read through the original ArrayCell[]; node preserves the actual elements, order and length.
interface ArrayCell { value: number; }
function writeArray(xs: (ArrayCell | string)[], text: string): void {
  xs[1] = text;
  xs.push(text + "!");
}
function check(n: number): void {
  const first: ArrayCell = { value: n };
  const xs: ArrayCell[] = [first, { value: n + 1 }];
  const text = "cell:" + String(n);
  writeArray(xs, text);
  first.value = n + 2;
  const retained = xs[0];
  assert.sameValue<unknown>(retained, first);
  assert.sameValue(typeof retained, "object");
  if (typeof retained !== "object") throw new Error("Lost object element");
  assert.sameValue(retained.value, n + 2);
  assert.sameValue<unknown>(xs[1], text);
  assert.sameValue(typeof xs[1], "string");
  assert.sameValue(xs.length, 3);
  assert.compareArray<unknown>(xs, [first, text, text + "!"]);
  assert.compareArray(xs.map(value => typeof value), ["object", "string", "string"]);
}
for (const n of [-0, NaN, 2147483649]) check(n);
