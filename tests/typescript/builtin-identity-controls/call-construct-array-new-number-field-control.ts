/*---
description: Control for call-construct-array-new-number-field; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects]
---*/
// Paired case: ../builtin-identity/call-construct-array-new-number-field.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(n: number): number[] {
  const holder: { target: ArrayConstructor; value: number } = { target: Array, value: n };
  return new Array<number>(holder.value);
}
for (const n of [0, 1, 3, 7]) {
  const result = build(n);
  assert.sameValue(result.length, n);
  assert.sameValue<unknown>(result[0], undefined);
  assert.sameValue(0 in result, false);
  assert.sameValue(result instanceof Array, true);
}
