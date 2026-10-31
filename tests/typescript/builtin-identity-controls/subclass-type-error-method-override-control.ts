/*---
description: Control for subclass-type-error-method-override; construct TypeError directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-errors, ts-strings]
---*/
// Paired case: ../builtin-identity/subclass-type-error-method-override.ts.
// Change: Construct TypeError directly; adjust the subclass observations.
class IdentityTypeError extends TypeError {
  override toString(): string { return "own:" + this.message; }
}
function check(message: string): void {
  const result: TypeError = new TypeError(message);
  assert.sameValue(result.name, "TypeError");
  assert.sameValue(result.message, message);
  assert.sameValue(result.toString(), message === "" ? "TypeError" : "TypeError: " + message);
  assert.sameValue(result instanceof IdentityTypeError, false);
  assert.sameValue(result instanceof TypeError, true);
  assert.sameValue(new TypeError(message) instanceof IdentityTypeError, false);
}
for (const message of ["", "short", "different message", "\u03bb"]) check(message);
