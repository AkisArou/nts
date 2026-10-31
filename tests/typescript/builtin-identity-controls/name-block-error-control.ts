/*---
description: Control for name-block-error; the target resolves to the real Error builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-errors, ts-strings]
flags: [module]
---*/
// Control for ../builtin-identity/name-block-error.ts: rename the shadow declaration.
export {};
let calls: number = 0;
function check(message: string): void {
  {
    class OwnError {
      readonly name: string = "OwnError";
      readonly message: string;
      constructor(message: string) { calls++; this.message = "own:" + message; }
    }
    calls = 0;
    const result = new Error(message);
    assert.sameValue(result.name, "Error");
    assert.sameValue(result.message, message);
    assert.sameValue(calls, 0);
  }
}
for (const message of ["first", "second", "third"]) check(message);
