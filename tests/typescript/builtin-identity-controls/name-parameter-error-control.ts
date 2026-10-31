/*---
description: Control for name-parameter-error; the target resolves to the real Error builtin.
features: [ts-builtin-identity, ts-builtin-name, ts-functions, ts-iteration, ts-modules, ts-class, ts-errors, ts-strings, ts-construct-signatures]
flags: [module]
---*/
// Control for ../builtin-identity/name-parameter-error.ts: pass the real builtin.
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
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
  assert.sameValue(calls, 0);
}
for (const message of ["first", "second", "third"]) check(Error, message);
