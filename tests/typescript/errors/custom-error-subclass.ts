/*---
description: A class extending Error is an Error and its own class, with its own name, message and fields.
features: [ts-errors, ts-class, ts-builtin-subclass, ts-parameter-properties]
---*/
class ValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
function validate(age: number): void {
  if (age < 0) throw new ValidationError("age", "must be positive");
}
let caught: unknown;
try {
  validate(-1);
} catch (error) {
  caught = error;
}
assert.sameValue(caught instanceof ValidationError, true);
assert.sameValue(caught instanceof Error, true);
const error = caught as ValidationError;
assert.sameValue(error.field, "age");
assert.sameValue(String(error), "ValidationError: must be positive");
