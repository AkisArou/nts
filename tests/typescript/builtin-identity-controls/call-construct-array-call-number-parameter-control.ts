/*---
description: Control for call-construct-array-call-number-parameter; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-call-signatures]
---*/
// Paired case: ../builtin-identity/call-construct-array-call-number-parameter.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(target: ArrayConstructor, n: number): number[] {
  return Array<number>(n);
}
for (const n of [0, 1, 3, 7]) {
  const result = build(Array, n);
  assert.sameValue(result.length, n);
  assert.sameValue<unknown>(result[0], undefined);
  assert.sameValue(0 in result, false);
  assert.sameValue(result instanceof Array, true);
}
