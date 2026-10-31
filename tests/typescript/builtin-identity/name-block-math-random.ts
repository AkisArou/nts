/*---
description: A block-scoped Math namesake keeps its own random implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers]
flags: [module]
---*/
// Route: block binding named Math; node runs the program's own implementation.
export {};
let calls: number = 0;
let marker: number = 0;
function check(n: number): void {
  {
    const Math: { random(): number } = {
      random(): number { calls++; return marker; }
    };
    calls = 0;
    marker = n + 100;
    const result = Math.random();
    assert.sameValue(result, n + 100);
    assert.sameValue(calls, 1);
  }
}
for (const n of [1, 3, 7]) check(n);
