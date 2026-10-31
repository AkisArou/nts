/*---
description: Control for cast-eval-error-constructor; the actual builtin replaces the cast target.
features: [ts-builtin-identity, ts-builtin-cast, ts-type-assertions, ts-typeof-type, ts-iteration, ts-functions, ts-class, ts-class-fields, ts-errors, ts-strings, ts-instanceof]
---*/
// Paired case: ../builtin-identity/cast-eval-error-constructor.ts.
// Only the target changes to the builtin; expectations follow its result.
let calls = 0;
class OwnError {
  readonly name: string = "OwnError";
  readonly message: string;
  constructor(message: string) { calls++; this.message = "own:" + message; }
}
function check(message: string): void {
  calls = 0;
  const Target = EvalError;
  const value = new Target(message);
  assert.sameValue(calls, 0);
  assert.sameValue(value.name, "EvalError");
  assert.sameValue(value.message, message);
  assert.sameValue(value instanceof OwnError, false);
  assert.sameValue(value instanceof EvalError, true);
}
for (const message of ["", "first", "second", "tail"]) check(message);
