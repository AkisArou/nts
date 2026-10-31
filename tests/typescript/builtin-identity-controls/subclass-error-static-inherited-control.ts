/*---
description: Control for subclass-error-static-inherited; call Error.isError directly.
features: [ts-builtin-identity, ts-builtin-subclass, ts-class, ts-inheritance, ts-static, ts-functions, ts-iteration, ts-tuples, ts-unknown, ts-errors, ts-objects]
---*/
// Control for ../builtin-identity/subclass-error-static-inherited.ts: call the builtin static method directly.
class IdentityError extends Error {}
function check(value: unknown, expected: boolean): void {
  const result = Error.isError(value);
  assert.sameValue(result, expected);
}
const inputs: [unknown, boolean][] = [
  [new IdentityError("own:first"), true], [new Error("base"), true],
  [new TypeError("typed"), true], [{ name: "Error", message: "shape" }, false], [null, false]
];
for (const [value, expected] of inputs) check(value, expected);
