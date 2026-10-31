/*---
description: A parameter-scoped parseInt namesake keeps its own parseint implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-function-types, ts-numbers, ts-strings]
flags: [module]
---*/
// Route: typed parameter named parseInt; node runs the program's own implementation.
export {};
let calls: number = 0;
const triples: [string, number, number][] = [["11", 2, 3], ["21", 10, 21], ["ff", 16, 255]];
function OwnparseInt(text: string, radix: number): number {
  calls++; return text.length + radix + 100;
}

function check(parseInt: (text: string, radix: number) => number, text: string, radix: number, expected: number): void {
  calls = 0;
  const result = parseInt(text, radix);
  assert.sameValue(result, text.length + radix + 100);
  assert.sameValue(calls, 1);
}
for (const [text, radix, expected] of triples) check(OwnparseInt, text, radix, expected);
