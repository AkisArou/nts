/*---
description: A Error subclass forwards typed arguments through its own constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-errors, ts-strings]
---*/
// Route: a typed Error subclass forwards typed arguments through its own constructor; node preserves the subclass and its behavior.
let constructions = 0;
class IdentityError extends Error {
  constructor(message: string) {
    super("own:" + message);
    constructions++;
    this.name = "IdentityError";
  }
}
function check(message: string): void {
  const before = constructions;
  const result: Error = new IdentityError(message);
  assert.sameValue(constructions - before, 1);
  assert.sameValue(result.name, "IdentityError");
  assert.sameValue(result.message, "own:" + message);
  assert.sameValue(result instanceof IdentityError, true);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(new Error(message) instanceof IdentityError, false);
}
for (const message of ["", "short", "different message", "\u03bb"]) check(message);
