/*---
description: "Two interface implementations call ReferenceError without new and preserve their distinct message values."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-interfaces, ts-numbers, ts-instanceof]
flags: [module]
---*/
// Two interface implementations call ReferenceError without new and preserve their distinct message values. Route: an interface with direct and tagged factories.
// Node prints: construction-call-reference-error-interface:ok
interface ErrorMaker { make(message: string): Error; }
class DirectMaker implements ErrorMaker { make(message: string): Error { return ReferenceError(message); } }
class TaggedMaker implements ErrorMaker { make(message: string): Error { return ReferenceError("tag:" + message); } }
const makers: ErrorMaker[] = [new DirectMaker(), new TaggedMaker()];
for (const message of ["", "alpha", "omega"]) for (let index = 0; index < makers.length; index++) {
  const value: Error = makers[index].make(message);
  assert.sameValue(value instanceof ReferenceError, true);
  assert.sameValue(value.name, "ReferenceError");
  assert.sameValue(value.message, index === 0 ? message : "tag:" + message);
  assert.sameValue(Object.hasOwn(value, "message"), true);
}
console.log("construction-call-reference-error-interface:ok");
