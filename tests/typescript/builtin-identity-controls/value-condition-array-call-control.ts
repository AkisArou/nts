/*---
description: Control for value-condition-array-call; call Array directly instead of the conditional target; adjust its expected observations.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-function-types]
---*/
// Paired case: ../builtin-identity/value-condition-array-call.ts.
// Change: Call Array directly instead of the conditional target; adjust its expected observations.
let calls = 0;
function own(n: number): number[] { calls++; return [n, n + 1]; }
function check(useBuiltin: boolean, n: number): void {
  const Target: (n: number) => number[] = useBuiltin ? Array : own;
  const before = calls;
  const result = Array<number>(n);
  assert.sameValue(calls - before, 0);
  assert.sameValue(result.length, n);
  assert.sameValue<number | undefined>(result[0], undefined);
  assert.sameValue<number | undefined>(result[1], undefined);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [0, 1, 3, 7]) {
  for (const useBuiltin of [false, true]) check(useBuiltin, n);
}
