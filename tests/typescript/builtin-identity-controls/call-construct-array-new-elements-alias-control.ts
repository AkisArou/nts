/*---
description: Control for call-construct-array-new-elements-alias; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-tuples, ts-destructuring]
---*/
// Paired case: ../builtin-identity/call-construct-array-new-elements-alias.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
function build(a: number, b: number): number[] {
  const target: ArrayConstructor = Array;
  return new Array<number>(a, b);
}
const inputs: [number, number][] = [[0, 4], [2, 9], [-3, 5]];
for (const [a, b] of inputs) {
  const result = build(a, b);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], a);
  assert.sameValue(result[1], b);
}
