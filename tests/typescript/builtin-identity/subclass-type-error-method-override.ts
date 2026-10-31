/*---
description: A TypeError subclass dispatches an override through a base-typed value.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-override, ts-errors, ts-strings]
---*/
// Route: a typed TypeError subclass dispatches an override through a base-typed value; node preserves the subclass and its behavior.
class IdentityTypeError extends TypeError {
  override toString(): string { return "own:" + this.message; }
}
function check(message: string): void {
  const result: TypeError = new IdentityTypeError(message);
  assert.sameValue(result.name, "TypeError");
  assert.sameValue(result.message, message);
  assert.sameValue(result.toString(), "own:" + message);
  assert.sameValue(result instanceof IdentityTypeError, true);
  assert.sameValue(result instanceof TypeError, true);
  assert.sameValue(new TypeError(message) instanceof IdentityTypeError, false);
}
for (const message of ["", "short", "different message", "\u03bb"]) check(message);
