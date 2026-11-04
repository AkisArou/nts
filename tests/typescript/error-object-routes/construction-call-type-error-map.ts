/*---
description: "TypeError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-function-types, ts-null-undefined, ts-narrowing, ts-instanceof]
flags: [module]
---*/
// TypeError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a guarded Map function value.
// Node prints: construction-call-type-error-map:ok
const makers: Map<string, (message: string) => Error> = new Map();
makers.set("type", TypeError);
const make = makers.get("type"); if (make === undefined) throw "missing maker";
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = make(message);
  assert.sameValue(value instanceof TypeError, true);
  assert.sameValue(value.name, "TypeError");
  assert.sameValue(value.message, message);
  assert.sameValue(Object.hasOwn(value, "message"), true);
}
console.log("construction-call-type-error-map:ok");
