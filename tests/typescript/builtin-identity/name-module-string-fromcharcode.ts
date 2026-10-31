/*---
description: A module-scoped String namesake keeps its own fromcharcode implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-objects, ts-strings]
flags: [module]
---*/
// Route: module binding named String; node runs the program's own implementation.
export {};
let calls: number = 0;
const pairs: [number, string][] = [[65, "A"], [66, "B"], [90, "Z"]];
const String: { fromCharCode(code: number): string } = {
  fromCharCode(code: number): string { calls++; return "own:" + code; }
};

function check(code: number, expected: string): void {
  calls = 0;
  const result = String.fromCharCode(code);
  assert.sameValue(result, "own:" + code);
  assert.sameValue(calls, 1);
}
for (const [code, expected] of pairs) check(code, expected);
