/*---
description: Control for call-construct-array-call-union-parameter; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-narrowing, ts-call-signatures]
---*/
// Paired case: ../builtin-identity/call-construct-array-call-union-parameter.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(target: ArrayConstructor, x: number | string): (number | string)[] {
  return Array<number | string>(x);
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
