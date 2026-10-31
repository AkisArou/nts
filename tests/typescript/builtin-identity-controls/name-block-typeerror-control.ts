/*---
description: Control for name-block-typeerror; the target resolves to the real TypeError builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-errors, ts-strings]
flags: [module]
---*/
// Control for ../builtin-identity/name-block-typeerror.ts: rename the shadow declaration.
export {};
let calls: number = 0;
function check(message: string): void {
  {
    class OwnTypeError {
      readonly name: string = "OwnTypeError";
      readonly message: string;
      constructor(message: string) { calls++; this.message = "own:" + message; }
    }
    calls = 0;
    const result = new TypeError(message);
    assert.sameValue(result.name, "TypeError");
    assert.sameValue(result.message, message);
    assert.sameValue(calls, 0);
  }
}
for (const message of ["first", "second", "third"]) check(message);
