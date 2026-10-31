/*---
description: Control for name-namespace-parseint; the target resolves to the real parseInt builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-numbers, ts-strings, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-parseint.ts: rename the shadow declaration.
export {};
let calls: number = 0;
const triples: [string, number, number][] = [["11", 2, 3], ["21", 10, 21], ["ff", 16, 255]];
namespace Local {
  function OwnparseInt(text: string, radix: number): number {
    calls++; return text.length + radix + 100;
  }
  export function check(text: string, radix: number, expected: number): void {
    calls = 0;
    const result = parseInt(text, radix);
    assert.sameValue(result, expected);
    assert.sameValue(calls, 0);
  }
}
for (const [text, radix, expected] of triples) Local.check(text, radix, expected);
