/*---
description: A parameter-scoped Error namesake keeps its own constructor implementation.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-errors, ts-strings, ts-construct-signatures]
flags: [module]
---*/
// Route: typed parameter named Error; node runs the program's own implementation.
export {};
let calls: number = 0;
class OwnError {
  readonly name: string = "OwnError";
  readonly message: string;
  constructor(message: string) { calls++; this.message = "own:" + message; }
}

function check(Error: new (message: string) => { readonly name: string; readonly message: string }, message: string): void {
  calls = 0;
  const result = new Error(message);
  assert.sameValue(result.name, "OwnError");
  assert.sameValue(result.message, "own:" + message);
  assert.sameValue(calls, 1);
}
for (const message of ["first", "second", "third"]) check(OwnError, message);
