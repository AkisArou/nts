/*---
description: Control for subclass-error-method-override; construct Error directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-errors, ts-strings]
---*/
// Paired case: ../builtin-identity/subclass-error-method-override.ts.
// Change: Construct Error directly; adjust the subclass observations.
class IdentityError extends Error {
  override toString(): string { return "own:" + this.message; }
}
function check(message: string): void {
  const result: Error = new Error(message);
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
  assert.sameValue(result.toString(), message === "" ? "Error" : "Error: " + message);
  assert.sameValue(result instanceof IdentityError, false);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(new Error(message) instanceof IdentityError, false);
}
for (const message of ["", "short", "different message", "\u03bb"]) check(message);
