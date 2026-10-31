/*---
description: Two typed Array arguments through an alias remain elements, including a negative first value.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-tuples, ts-destructuring]
---*/
// Route: two typed elements constructed through an alias; node preserves the target and argument semantics.
function build(a: number, b: number): number[] {
  const target: ArrayConstructor = Array;
  return new target<number>(a, b);
}
const inputs: [number, number][] = [[0, 4], [2, 9], [-3, 5]];
for (const [a, b] of inputs) {
  const result = build(a, b);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], a);
  assert.sameValue(result[1], b);
}
