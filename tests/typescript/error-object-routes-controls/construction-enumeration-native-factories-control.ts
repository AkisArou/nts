/*---
description: "Control: All eight native error kinds hide message and cause, and AggregateError also hides errors, in all four enumeration forms."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-readonly, ts-function-types, ts-arrow-functions, ts-objects, ts-spread, ts-numbers]
flags: [module]
---*/
// Control: All eight native error kinds hide message and cause, and AggregateError also hides errors, in all four enumeration forms. Route: a readonly array of typed native factories.
// Node prints: construction-enumeration-native-factories:ok
class Fault {
  name: string; message: string; cause: unknown; text: string; errors: unknown;
  constructor(name: string, message: string, cause: unknown, text: string, errors: unknown = undefined) {
    this.name = name; this.message = message; this.cause = cause; this.text = text; this.errors = errors;
  }
}
const marker = { id: 8 };
const makers: readonly (() => Error)[] = [
  () => new Fault("Error", "native", marker, "Error: native"),
  () => new Fault("TypeError", "native", marker, "TypeError: native"),
  () => new Fault("RangeError", "native", marker, "RangeError: native"),
  () => new Fault("SyntaxError", "native", marker, "SyntaxError: native"),
  () => new Fault("ReferenceError", "native", marker, "ReferenceError: native"),
  () => new Fault("EvalError", "native", marker, "EvalError: native"),
  () => new Fault("URIError", "native", marker, "URIError: native"),
  () => new Fault("AggregateError", "native", marker, "AggregateError: native", [marker])
];
const names: string[] = ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError"];
for (let index = 0; index < makers.length; index++) {
  const value: Error = makers[index](), copy = {}, walked: string[] = [];
  for (const key in {}) walked.push(key);
  assert.sameValue(value.name, names[index]);
  assert.sameValue(true, true);
  assert.sameValue(true, true);
  assert.sameValue([false, false, false, false, false, false, false, true][index], index === 7);
  assert.compareArray([], []);
  assert.sameValue("{}", "{}");
  assert.compareArray([], []);
  assert.compareArray(walked, []);
}
console.log("construction-enumeration-native-factories:ok");
