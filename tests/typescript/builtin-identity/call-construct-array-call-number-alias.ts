/*---
description: Array call through a typed alias uses a numeric argument as a length.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Route: Array call through a typed alias; node preserves the target and argument semantics.
function build(n: number): number[] {
  const target: ArrayConstructor = Array;
  return target<number>(n);
}
for (const n of [0, 1, 3, 7]) {
  const result = build(n);
  assert.sameValue(result.length, n);
  assert.sameValue<unknown>(result[0], undefined);
  assert.sameValue(0 in result, false);
  assert.sameValue(result instanceof Array, true);
}
