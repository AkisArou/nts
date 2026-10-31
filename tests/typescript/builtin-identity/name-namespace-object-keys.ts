/*---
description: A namespace-scoped Object namesake keeps its own keys implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-arrays, ts-strings, ts-namespace]
flags: [module]
---*/
// Route: namespace binding named Object; node runs the program's own implementation.
export {};
let calls: number = 0;
namespace Local {
  const Object: { keys(value: { item: number }): string[] } = {
    keys(value: { item: number }): string[] { calls++; return ["own", "key:" + value.item]; }
  };
  export function check(n: number): void {
    calls = 0;
    const result = Object.keys({ item: n });
    assert.sameValue(result.length, 2);
    assert.sameValue(result[0], "own");
    assert.sameValue(result[1], "key:" + n);
    assert.sameValue(calls, 1);
  }
}
for (const n of [1, 3, 7]) Local.check(n);
