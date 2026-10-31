/*---
description: Array new through a typed parameter uses a numeric argument as a length.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-construct-signatures]
---*/
// Route: Array new through a typed parameter; node preserves the target and argument semantics.
function build(target: ArrayConstructor, n: number): number[] {
  return new target<number>(n);
}
for (const n of [0, 1, 3, 7]) {
  const result = build(Array, n);
  assert.sameValue(result.length, n);
  assert.sameValue<unknown>(result[0], undefined);
  assert.sameValue(0 in result, false);
  assert.sameValue(result instanceof Array, true);
}
