/*---
description: Control for cast-math-max; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-objects, ts-numbers, ts-closures]
---*/
// Paired case: ../builtin-identity/cast-math-max.ts.
// Only the target changes to the builtin; expectations follow its result.
function check(n: number): void {
  let calls = 0;
  const own = {
    max(a: number, b: number): number { calls++; return a + b + 100; }
  };
  const target = Math;
  const value = target.max(n, n + 2);
  assert.sameValue(calls, 0);
  assert.sameValue(value, n + 2);
}
for (const n of [-3, 0, 1, 7]) check(n);
