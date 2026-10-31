/*---
description: Control for name-block-parseint; the target resolves to the real parseInt builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-numbers, ts-strings]
flags: [module]
---*/
// Control for ../builtin-identity/name-block-parseint.ts: rename the shadow declaration.
export {};
let calls: number = 0;
const triples: [string, number, number][] = [["11", 2, 3], ["21", 10, 21], ["ff", 16, 255]];
function check(text: string, radix: number, expected: number): void {
  {
    function OwnparseInt(text: string, radix: number): number {
      calls++; return text.length + radix + 100;
    }
    calls = 0;
    const result = parseInt(text, radix);
    assert.sameValue(result, expected);
    assert.sameValue(calls, 0);
  }
}
for (const [text, radix, expected] of triples) check(text, radix, expected);
