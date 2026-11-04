/*---
description: "Every standard prototype owns its specified name and Error.prototype supplies the empty message through readonly prototype tuples."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Every standard prototype owns its specified name and Error.prototype supplies the empty message; route: readonly prototype tuples.
// Node prints: names-builtin-prototype-readonly:ok
const rows: readonly (readonly [Error, string])[] = [[Error.prototype, "Error"], [EvalError.prototype, "EvalError"], [RangeError.prototype, "RangeError"], [ReferenceError.prototype, "ReferenceError"], [SyntaxError.prototype, "SyntaxError"], [TypeError.prototype, "TypeError"], [URIError.prototype, "URIError"], [AggregateError.prototype, "AggregateError"]];
for (const [prototype, expected] of rows) {
  const own: boolean = Object.hasOwn(prototype, "name");
  assert.sameValue(prototype.name, expected); assert.sameValue(own, true);
  if (expected === "Error") assert.sameValue(prototype.message, "");
}
console.log("names-builtin-prototype-readonly:ok");
