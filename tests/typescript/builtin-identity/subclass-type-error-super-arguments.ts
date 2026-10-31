/*---
description: A TypeError subclass forwards typed arguments through its own constructor.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-errors, ts-strings]
---*/
// Route: a typed TypeError subclass forwards typed arguments through its own constructor; node preserves the subclass and its behavior.
let constructions = 0;
class IdentityTypeError extends TypeError {
  constructor(message: string) {
    super("own:" + message);
    constructions++;
    this.name = "IdentityTypeError";
  }
}
function check(message: string): void {
  const before = constructions;
  const result: TypeError = new IdentityTypeError(message);
  assert.sameValue(constructions - before, 1);
  assert.sameValue(result.name, "IdentityTypeError");
  assert.sameValue(result.message, "own:" + message);
  assert.sameValue(result instanceof IdentityTypeError, true);
  assert.sameValue(result instanceof TypeError, true);
  assert.sameValue(new TypeError(message) instanceof IdentityTypeError, false);
}
for (const message of ["", "short", "different message", "\u03bb"]) check(message);
