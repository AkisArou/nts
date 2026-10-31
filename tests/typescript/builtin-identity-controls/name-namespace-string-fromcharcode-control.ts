/*---
description: Control for name-namespace-string-fromcharcode; the target resolves to the real String builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-strings, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-string-fromcharcode.ts: rename the shadow declaration.
export {};
let calls: number = 0;
const pairs: [number, string][] = [[65, "A"], [66, "B"], [90, "Z"]];
namespace Local {
  const OwnString: { fromCharCode(code: number): string } = {
    fromCharCode(code: number): string { calls++; return "own:" + code; }
  };
  export function check(code: number, expected: string): void {
    calls = 0;
    const result = String.fromCharCode(code);
    assert.sameValue(result, expected);
    assert.sameValue(calls, 0);
  }
}
for (const [code, expected] of pairs) Local.check(code, expected);
