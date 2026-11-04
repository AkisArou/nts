/*---
description: "Generic prototype reads preserve every standard name and the Error prototype empty message through a constrained observer at Error and TypeError."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-generics, ts-generic-constraints, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Generic prototype reads preserve every standard name and the Error prototype empty message; route: a constrained observer at Error and TypeError.
// Node prints: names-builtin-prototype-generic:ok
function inspect<E extends Error>(prototype: E, expected: string, message: boolean): void {
  const own: boolean = Object.hasOwn(prototype, "name");
  assert.sameValue(prototype.name, expected); assert.sameValue(own, true);
  if (message) assert.sameValue(prototype.message, "");
}
const rows: readonly (readonly [Error, string])[] = [[Error.prototype, "Error"], [EvalError.prototype, "EvalError"], [RangeError.prototype, "RangeError"], [ReferenceError.prototype, "ReferenceError"], [SyntaxError.prototype, "SyntaxError"], [URIError.prototype, "URIError"], [AggregateError.prototype, "AggregateError"]];
for (const [prototype, expected] of rows) inspect<Error>(prototype, expected, expected === "Error");
inspect<TypeError>(TypeError.prototype, "TypeError", false);
console.log("names-builtin-prototype-generic:ok");
