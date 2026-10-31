/*---
description: A block-scoped Math namesake keeps its own max implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Route: block binding named Math; node runs the program's own implementation.
export {};
let calls: number = 0;
const pairs: [number, number][] = [[1, 4], [-3, 7], [8, 2]];
function check(a: number, b: number): void {
  {
    const Math: { max(a: number, b: number): number } = {
      max(a: number, b: number): number { calls++; return a - b + 100; }
    };
    calls = 0;
    const result = Math.max(a, b);
    assert.sameValue(result, a - b + 100);
    assert.sameValue(calls, 1);
  }
}
for (const [a, b] of pairs) check(a, b);
