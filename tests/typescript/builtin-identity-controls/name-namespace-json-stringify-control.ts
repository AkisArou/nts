/*---
description: Control for name-namespace-json-stringify; the target resolves to the real JSON builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-strings, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-json-stringify.ts: rename the shadow declaration.
export {};
let calls: number = 0;
namespace Local {
  const OwnJSON: { stringify(value: { item: number }): string } = {
    stringify(value: { item: number }): string { calls++; return "own:" + value.item; }
  };
  export function check(n: number): void {
    calls = 0;
    const result = JSON.stringify({ item: n });
    assert.sameValue(result, '{"item":' + n + '}');
    assert.sameValue(calls, 0);
  }
}
for (const n of [1, 3, 7]) Local.check(n);
