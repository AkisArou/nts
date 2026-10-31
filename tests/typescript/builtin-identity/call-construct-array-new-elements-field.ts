/*---
description: Two typed Array arguments through a field remain elements, including a negative first value.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-tuples, ts-destructuring, ts-objects]
---*/
// Route: two typed elements constructed through a field; node preserves the target and argument semantics.
function build(a: number, b: number): number[] {
  const holder: { target: ArrayConstructor; a: number; b: number } = { target: Array, a, b };
  return new holder.target<number>(holder.a, holder.b);
}
const inputs: [number, number][] = [[0, 4], [2, 9], [-3, 5]];
for (const [a, b] of inputs) {
  const result = build(a, b);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], a);
  assert.sameValue(result[1], b);
}
