/*---
description: "Every standard prototype owns its specified name and Error.prototype supplies the empty message through a guarded Map of prototype values."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-map-set, ts-narrowing, ts-arrays, ts-readonly, ts-iteration]
flags: [module]
---*/
// Every standard prototype owns its specified name and Error.prototype supplies the empty message; route: a guarded Map of prototype values.
// Node prints: names-builtin-prototype-map:ok
const held: Map<string, Error> = new Map([["Error", Error.prototype], ["EvalError", EvalError.prototype], ["RangeError", RangeError.prototype], ["ReferenceError", ReferenceError.prototype], ["SyntaxError", SyntaxError.prototype], ["TypeError", TypeError.prototype], ["URIError", URIError.prototype], ["AggregateError", AggregateError.prototype]]);
const names: readonly string[] = ["Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError", "AggregateError"];
for (const expected of names) {
  const prototype = held.get(expected); if (prototype === undefined) throw "missing";
  const own: boolean = Object.hasOwn(prototype, "name");
  assert.sameValue(prototype.name, expected); assert.sameValue(own, true);
  if (expected === "Error") assert.sameValue(prototype.message, "");
}
console.log("names-builtin-prototype-map:ok");
