/*---
description: Control for subclass-error-super-arguments; construct Error directly; adjust the subclass observations.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-instanceof, ts-functions, ts-errors, ts-strings]
---*/
// Paired case: ../builtin-identity/subclass-error-super-arguments.ts.
// Change: Construct Error directly; adjust the subclass observations.
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
  const result: Error = new Error(message);
  assert.sameValue(constructions - before, 0);
  assert.sameValue(result.name, "Error");
  assert.sameValue(result.message, message);
  assert.sameValue(result instanceof IdentityError, false);
  assert.sameValue(result instanceof Error, true);
  assert.sameValue(new Error(message) instanceof IdentityError, false);
}
for (const message of ["", "short", "different message", "\u03bb"]) check(message);
