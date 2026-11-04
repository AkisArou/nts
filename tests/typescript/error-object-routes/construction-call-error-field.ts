/*---
description: "Error called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-function-types, ts-instanceof]
flags: [module]
---*/
// Error called without new creates the right native instance and preserves empty and nonempty own messages. Route: a public callable-constructor field.
// Node prints: construction-call-error-field:ok
class Maker { make: (message: string) => Error = Error; }
const maker = new Maker();
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = maker.make(message);
  assert.sameValue(value instanceof Error, true);
  assert.sameValue(value.name, "Error");
  assert.sameValue(value.message, message);
  assert.sameValue(Object.hasOwn(value, "message"), true);
}
console.log("construction-call-error-field:ok");
