/*---
description: Control for cast-math-min; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-objects, ts-numbers, ts-closures]
---*/
// Paired case: ../builtin-identity/cast-math-min.ts.
// Only the target changes to the builtin; expectations follow its result.
function check(n: number): void {
  let calls = 0;
  const own = {
    min(a: number, b: number): number { calls++; return a + b + 100; }
  };
  const target = Math;
  const value = target.min(n, n + 2);
  assert.sameValue(calls, 0);
  assert.sameValue(value, n);
}
for (const n of [-3, 0, 1, 7]) check(n);
