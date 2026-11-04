/*---
description: "RangeError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-readonly, ts-function-types, ts-instanceof]
flags: [module]
---*/
// RangeError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a readonly callable-constructor array.
// Node prints: construction-call-range-error-readonly:ok
const makers: readonly ((message: string) => Error)[] = [RangeError];
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = makers[0](message);
  assert.sameValue(value instanceof RangeError, true);
  assert.sameValue(value.name, "RangeError");
  assert.sameValue(value.message, message);
  assert.sameValue(Object.hasOwn(value, "message"), true);
}
console.log("construction-call-range-error-readonly:ok");
