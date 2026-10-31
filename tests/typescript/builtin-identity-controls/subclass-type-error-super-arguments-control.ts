/*---
description: Control for subclass-type-error-super-arguments; construct TypeError directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-errors, ts-strings]
---*/
// Paired case: ../builtin-identity/subclass-type-error-super-arguments.ts.
// Change: Construct TypeError directly; adjust the subclass observations.
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
  const result: TypeError = new TypeError(message);
  assert.sameValue(constructions - before, 0);
  assert.sameValue(result.name, "TypeError");
  assert.sameValue(result.message, message);
  assert.sameValue(result instanceof IdentityTypeError, false);
  assert.sameValue(result instanceof TypeError, true);
  assert.sameValue(new TypeError(message) instanceof IdentityTypeError, false);
}
for (const message of ["", "short", "different message", "\u03bb"]) check(message);
