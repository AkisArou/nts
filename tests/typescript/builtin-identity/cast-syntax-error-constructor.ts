/*---
description: An own class cast to SyntaxError retains its own name and message.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-errors, ts-strings, ts-instanceof]
---*/
// Route: a class is asserted to be SyntaxError; node runs the own constructor.
let calls = 0;
class OwnError {
  readonly name: string = "OwnError";
  readonly message: string;
  constructor(message: string) { calls++; this.message = "own:" + message; }
}
function check(message: string): void {
  calls = 0;
  const Target = OwnError as unknown as typeof SyntaxError;
  const value = new Target(message);
  assert.sameValue(calls, 1);
  assert.sameValue(value.name, "OwnError");
  assert.sameValue(value.message, "own:" + message);
  assert.sameValue(value instanceof OwnError, true);
  assert.sameValue(value instanceof SyntaxError, false);
}
for (const message of ["", "first", "second", "tail"]) check(message);
