/*---
description: Control for name-parameter-parseint; the target resolves to the real parseInt builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-function-types, ts-numbers, ts-strings]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-parseint.ts: pass the real builtin.
export {};
let calls: number = 0;
const triples: [string, number, number][] = [["11", 2, 3], ["21", 10, 21], ["ff", 16, 255]];
function OwnparseInt(text: string, radix: number): number {
  calls++; return text.length + radix + 100;
}

function check(parseInt: (text: string, radix: number) => number, text: string, radix: number, expected: number): void {
  calls = 0;
  const result = parseInt(text, radix);
  assert.sameValue(result, expected);
  assert.sameValue(calls, 0);
}
for (const [text, radix, expected] of triples) check(parseInt, text, radix, expected);
