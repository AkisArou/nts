/*---
description: Control for name-parameter-string-fromcharcode; the target resolves to the real String builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-strings]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-string-fromcharcode.ts: pass the real builtin.
export {};
let calls: number = 0;
const pairs: [number, string][] = [[65, "A"], [66, "B"], [90, "Z"]];
const OwnString: { fromCharCode(code: number): string } = {
  fromCharCode(code: number): string { calls++; return "own:" + code; }
};

function check(String: { fromCharCode(code: number): string }, code: number, expected: string): void {
  calls = 0;
  const result = String.fromCharCode(code);
  assert.sameValue(result, expected);
  assert.sameValue(calls, 0);
}
for (const [code, expected] of pairs) check(String, code, expected);
