/*---
description: An Error check narrows a union while distinguishing sibling errors from message-shaped literals.
features: [ts-instanceof-routes, ts-instanceof-route-builtins, ts-class, ts-functions, ts-type-aliases, ts-unions, ts-narrowing, ts-arrays, ts-tuples, ts-inheritance, ts-builtin-subclass, ts-iteration, ts-objects, ts-unknown, ts-errors, ts-strings, ts-instanceof]
---*/
// Error, string and message-shaped values cross an ErrorInput parameter; node selects the Error arm only for chains containing Error.prototype.
class RecoverableError extends TypeError {}
type ErrorInput = Error | string | { message: string };
function describe(value: ErrorInput): [boolean, string] {
  if (value instanceof Error) return [true, value.message];
  return [false, typeof value === "string" ? value : value.message];
}
const samples: [ErrorInput, boolean, string][] = [
  [new Error("base"), true, "base"], [new TypeError("type"), true, "type"], [new RangeError("range"), true, "range"],
  [new RecoverableError("child"), true, "child"], [{ message: "base" }, false, "base"], ["", false, ""]
];
for (const [value, isError, message] of samples) {
  const answer = describe(value);
  assert.compareArray(answer, [isError, message]);
}
