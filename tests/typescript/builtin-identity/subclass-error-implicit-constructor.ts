/*---
description: A Error subclass inherits its constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-errors, ts-strings]
---*/
// Route: a typed Error subclass inherits its constructor; node preserves the subclass and its behavior.
class IdentityError extends Error {}
function check(message: string): void {
  const result: Error = new IdentityError(message);
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
  assert.sameValue(result instanceof IdentityError, true);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(new Error(message) instanceof IdentityError, false);
}
for (const message of ["", "short", "different message", "\u03bb"]) check(message);
