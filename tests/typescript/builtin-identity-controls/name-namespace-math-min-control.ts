/*---
description: Control for name-namespace-math-min; the target resolves to the real Math builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-math-min.ts: rename the shadow declaration.
export {};
let calls: number = 0;
const pairs: [number, number][] = [[1, 4], [-3, 7], [8, 2]];
namespace Local {
  const OwnMath: { min(a: number, b: number): number } = {
    min(a: number, b: number): number { calls++; return a - b + 200; }
  };
  export function check(a: number, b: number): void {
    calls = 0;
    const result = Math.min(a, b);
    assert.sameValue(result, a < b ? a : b);
    assert.sameValue(calls, 0);
  }
}
for (const [a, b] of pairs) Local.check(a, b);
