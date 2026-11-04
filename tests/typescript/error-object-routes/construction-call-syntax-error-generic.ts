/*---
description: "SyntaxError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-generics, ts-generic-constraints, ts-function-types, ts-instanceof]
flags: [module]
---*/
// SyntaxError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a generic callable helper at Error and SyntaxError result types.
// Node prints: construction-call-syntax-error-generic:ok
function invoke<T extends Error>(factory: (message: string) => T, message: string): T { return factory(message); }
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = message === "" ? invoke<Error>(SyntaxError, message) : invoke<SyntaxError>(SyntaxError, message);
  assert.sameValue(value instanceof SyntaxError, true);
  assert.sameValue(value.name, "SyntaxError");
  assert.sameValue(value.message, message);
  assert.sameValue(Object.hasOwn(value, "message"), true);
}
console.log("construction-call-syntax-error-generic:ok");
