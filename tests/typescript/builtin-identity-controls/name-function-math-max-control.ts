/*---
description: Control for name-function-math-max; the target resolves to the real Math builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Control for ../builtin-identity/name-function-math-max.ts: rename the shadow declaration.
export {};
let calls: number = 0;
const pairs: [number, number][] = [[1, 4], [-3, 7], [8, 2]];
function check(a: number, b: number): void {
  const OwnMath: { max(a: number, b: number): number } = {
    max(a: number, b: number): number { calls++; return a - b + 100; }
  };
  calls = 0;
  const result = Math.max(a, b);
  assert.sameValue(result, a > b ? a : b);
  assert.sameValue(calls, 0);
}
for (const [a, b] of pairs) check(a, b);
