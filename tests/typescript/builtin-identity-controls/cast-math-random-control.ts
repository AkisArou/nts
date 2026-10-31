/*---
description: Control for cast-math-random; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-objects, ts-numbers, ts-closures]
---*/
// Paired case: ../builtin-identity/cast-math-random.ts.
// Only the target changes to the builtin; expectations follow its result.
function check(n: number): void {
  let calls = 0;
  const own = {
    random(): number { calls++; return n + 100; }
  };
  const target = Math;
  const value = target.random();
  assert.sameValue(calls, 0);
  assert.sameValue(value >= 0 && value < 1, true);
}
for (const n of [0, 1, 3, 7]) check(n);
