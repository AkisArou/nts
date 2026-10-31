/*---
description: Control for name-parameter-number-parsefloat; the target resolves to the real Number builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-numbers, ts-strings]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-number-parsefloat.ts: pass the real builtin.
export {};
let calls: number = 0;
const pairs: [string, number][] = [["1.5", 1.5], ["-2.25", -2.25], ["7e1", 70]];
const OwnNumber: { parseFloat(text: string): number } = {
  parseFloat(text: string): number { calls++; return text.length + 100; }
};

function check(Number: { parseFloat(text: string): number }, text: string, expected: number): void {
  calls = 0;
  const result = Number.parseFloat(text);
  assert.sameValue(result, expected);
  assert.sameValue(calls, 0);
}
for (const [text, expected] of pairs) check(Number, text, expected);
