/*---
description: Control for call-construct-array-call-union-alias; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-narrowing]
---*/
// Paired case: ../builtin-identity/call-construct-array-call-union-alias.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(x: number | string): (number | string)[] {
  const target: ArrayConstructor = Array;
  return Array<number | string>(x);
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
