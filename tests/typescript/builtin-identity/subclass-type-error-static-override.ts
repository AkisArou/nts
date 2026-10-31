/*---
description: A TypeError subclass overrides isError with its own message filter.
features: [ts-builtin-identity, ts-builtin-subclass, ts-class, ts-inheritance, ts-static, ts-functions, ts-iteration, ts-tuples, ts-unknown, ts-errors, ts-objects, ts-override, ts-type-guards, ts-narrowing, ts-strings]
---*/
// Route: a typed TypeError subclass overrides isError; node counts its call and applies its message filter.
let calls = 0;
class IdentityTypeError extends TypeError {
  static override isError(value: unknown): value is Error {
    calls++;
    return super.isError(value) && value.message.startsWith("own:");
  }
}
function check(value: unknown, builtinExpected: boolean, ownExpected: boolean): void {
  const before = calls;
  const result = IdentityTypeError.isError(value);
  assert.sameValue(calls - before, 1);
  assert.sameValue(result, ownExpected);
}
const inputs: [unknown, boolean, boolean][] = [
  [new IdentityTypeError("own:first"), true, true], [new IdentityTypeError("plain"), true, false],
  [new Error("own:base"), true, true], [new Error("base"), true, false],
  [{ name: "Error", message: "own:shape" }, false, false], [null, false, false]
];
for (const [value, builtinExpected, ownExpected] of inputs) check(value, builtinExpected, ownExpected);
