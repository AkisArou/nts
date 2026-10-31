/*---
description: Control for name-namespace-number-parsefloat; the target resolves to the real Number builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers, ts-strings, ts-namespace]
flags: [module]
---*/
// Control for ../builtin-identity/name-namespace-number-parsefloat.ts: rename the shadow declaration.
export {};
let calls: number = 0;
const pairs: [string, number][] = [["1.5", 1.5], ["-2.25", -2.25], ["7e1", 70]];
namespace Local {
  const OwnNumber: { parseFloat(text: string): number } = {
    parseFloat(text: string): number { calls++; return text.length + 100; }
  };
  export function check(text: string, expected: number): void {
    calls = 0;
    const result = Number.parseFloat(text);
    assert.sameValue(result, expected);
    assert.sameValue(calls, 0);
  }
}
for (const [text, expected] of pairs) Local.check(text, expected);
