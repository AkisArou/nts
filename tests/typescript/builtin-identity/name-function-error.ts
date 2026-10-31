/*---
description: A function-scoped Error namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-errors, ts-strings]
flags: [module]
---*/
// Route: function binding named Error; node runs the program's own implementation.
export {};
let calls: number = 0;
function check(message: string): void {
  class Error {
    readonly name: string = "OwnError";
    readonly message: string;
    constructor(message: string) { calls++; this.message = "own:" + message; }
  }
  calls = 0;
  const result = new Error(message);
  assert.sameValue(result.name, "OwnError");
  assert.sameValue(result.message, "own:" + message);
  assert.sameValue(calls, 1);
}
for (const message of ["first", "second", "third"]) check(message);
