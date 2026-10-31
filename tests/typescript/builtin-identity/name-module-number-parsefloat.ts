/*---
description: A module-scoped Number namesake keeps its own parsefloat implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers, ts-strings]
flags: [module]
---*/
// Route: module binding named Number; node runs the program's own implementation.
export {};
let calls: number = 0;
const pairs: [string, number][] = [["1.5", 1.5], ["-2.25", -2.25], ["7e1", 70]];
const Number: { parseFloat(text: string): number } = {
  parseFloat(text: string): number { calls++; return text.length + 100; }
};

function check(text: string, expected: number): void {
  calls = 0;
  const result = Number.parseFloat(text);
  assert.sameValue(result, text.length + 100);
  assert.sameValue(calls, 1);
}
for (const [text, expected] of pairs) check(text, expected);
