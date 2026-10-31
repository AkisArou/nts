/*---
description: Array call through a typed parameter distinguishes numeric lengths from string elements.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-narrowing, ts-call-signatures]
---*/
// Route: a union argument to Array call through a typed parameter; node preserves the target and argument semantics.
function build(target: ArrayConstructor, x: number | string): (number | string)[] {
  return target<number | string>(x);
}
const inputs: (number | string)[] = [0, 2, 5, "2", "word", ""];
for (const x of inputs) {
  const result = build(Array, x);
  if (typeof x === "number") {
    assert.sameValue(result.length, x);
    assert.sameValue<unknown>(result[0], undefined);
    assert.sameValue(0 in result, false);
  } else {
    assert.sameValue(result.length, 1);
    assert.sameValue(result[0], x);
  }
}
