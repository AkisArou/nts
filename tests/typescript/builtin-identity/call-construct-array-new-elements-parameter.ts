/*---
description: Two typed Array arguments through a parameter remain elements, including a negative first value.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-tuples, ts-destructuring, ts-construct-signatures]
---*/
// Route: two typed elements constructed through a parameter; node preserves the target and argument semantics.
function build(target: ArrayConstructor, a: number, b: number): number[] {
  return new target<number>(a, b);
}
const inputs: [number, number][] = [[0, 4], [2, 9], [-3, 5]];
for (const [a, b] of inputs) {
  const result = build(Array, a, b);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], a);
  assert.sameValue(result[1], b);
}
