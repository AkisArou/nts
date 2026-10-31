/*---
description: Control for subclass-type-error-static-override; call TypeError.isError directly.
features: [ts-builtin-identity, ts-builtin-subclass, ts-class, ts-inheritance, ts-static, ts-functions, ts-iteration, ts-tuples, ts-unknown, ts-errors, ts-objects, ts-override, ts-type-guards, ts-narrowing, ts-strings]
---*/
// Control for ../builtin-identity/subclass-type-error-static-override.ts: call the builtin static method directly.
let calls = 0;
class IdentityTypeError extends TypeError {
  static override isError(value: unknown): value is Error {
    calls++;
    return super.isError(value) && value.message.startsWith("own:");
  }
}
function check(value: unknown, builtinExpected: boolean, ownExpected: boolean): void {
  const before = calls;
  const result = TypeError.isError(value);
  assert.sameValue(calls - before, 0);
  assert.sameValue(result, builtinExpected);
}
const inputs: [unknown, boolean, boolean][] = [
  [new IdentityTypeError("own:first"), true, true], [new IdentityTypeError("plain"), true, false],
  [new Error("own:base"), true, true], [new Error("base"), true, false],
  [{ name: "Error", message: "own:shape" }, false, false], [null, false, false]
];
for (const [value, builtinExpected, ownExpected] of inputs) check(value, builtinExpected, ownExpected);
