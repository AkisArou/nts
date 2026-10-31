/*---
description: A block-scoped JSON namesake keeps its own stringify implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-strings]
flags: [module]
---*/
// Route: block binding named JSON; node runs the program's own implementation.
export {};
let calls: number = 0;
function check(n: number): void {
  {
    const JSON: { stringify(value: { item: number }): string } = {
      stringify(value: { item: number }): string { calls++; return "own:" + value.item; }
    };
    calls = 0;
    const result = JSON.stringify({ item: n });
    assert.sameValue(result, "own:" + n);
    assert.sameValue(calls, 1);
  }
}
for (const n of [1, 3, 7]) check(n);
