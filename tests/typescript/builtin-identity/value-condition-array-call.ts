/*---
description: A conditional function value selects Array or a user function on both paths.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-function-types]
---*/
// Route: a typed call target joins Array and an own function; node calls the selected value.
let calls = 0;
function own(n: number): number[] { calls++; return [n, n + 1]; }
function check(useBuiltin: boolean, n: number): void {
  const Target: (n: number) => number[] = useBuiltin ? Array : own;
  const before = calls;
  const result = Target(n);
  assert.sameValue(calls - before, useBuiltin ? 0 : 1);
  assert.sameValue(result.length, useBuiltin ? n : 2);
  assert.sameValue<number | undefined>(result[0], useBuiltin ? undefined : n);
  assert.sameValue<number | undefined>(result[1], useBuiltin ? undefined : n + 1);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [0, 1, 3, 7]) {
  for (const useBuiltin of [false, true]) check(useBuiltin, n);
}
