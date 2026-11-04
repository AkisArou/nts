/*---
description: "URIError called without new creates the right native instance and preserves empty and nonempty own messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-closures, ts-arrow-functions, ts-function-types, ts-instanceof]
flags: [module]
---*/
// URIError called without new creates the right native instance and preserves empty and nonempty own messages. Route: a closure over a mutable message binding.
// Node prints: construction-call-uri-error-captured-let:ok
let current: string = "unread";
const make: () => Error = () => URIError(current);
const messages: string[] = ["", "alpha", "omega"];
for (const message of messages) {
  const value: Error = (current = message, make());
  assert.sameValue(value instanceof URIError, true);
  assert.sameValue(value.name, "URIError");
  assert.sameValue(value.message, message);
  assert.sameValue(Object.hasOwn(value, "message"), true);
}
console.log("construction-call-uri-error-captured-let:ok");
