/*---
description: Array new through a typed alias distinguishes numeric lengths from string elements.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-narrowing]
---*/
// Route: a union argument to Array new through a typed alias; node preserves the target and argument semantics.
function build(x: number | string): (number | string)[] {
  const target: ArrayConstructor = Array;
  return new target<number | string>(x);
}
const inputs: (number | string)[] = [0, 2, 5, "2", "word", ""];
for (const x of inputs) {
  const result = build(x);
  if (typeof x === "number") {
    assert.sameValue(result.length, x);
    assert.sameValue<unknown>(result[0], undefined);
    assert.sameValue(0 in result, false);
  } else {
    assert.sameValue(result.length, 1);
    assert.sameValue(result[0], x);
  }
}
