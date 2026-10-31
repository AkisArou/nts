/*---
description: An Error subclass inherits isError and recognizes real errors.
features: [ts-builtin-identity, ts-builtin-subclass, ts-class, ts-inheritance, ts-static, ts-functions, ts-iteration, ts-tuples, ts-unknown, ts-errors, ts-objects]
---*/
// Route: a typed Error subclass inherits isError; node rejects plain objects with error-shaped fields.
class IdentityError extends Error {}
function check(value: unknown, expected: boolean): void {
  const result = IdentityError.isError(value);
  assert.sameValue(result, expected);
}
const inputs: [unknown, boolean][] = [
  [new IdentityError("own:first"), true], [new Error("base"), true],
  [new TypeError("typed"), true], [{ name: "Error", message: "shape" }, false], [null, false]
];
for (const [value, expected] of inputs) check(value, expected);
