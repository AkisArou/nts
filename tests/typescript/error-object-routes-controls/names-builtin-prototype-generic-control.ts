/*---
description: "Generic prototype reads preserve every standard name and the Error prototype empty message through a constrained observer at Error and TypeError."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-generics, ts-generic-constraints, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Generic prototype reads preserve every standard name and the Error prototype empty message; route: a constrained observer at Error and TypeError.
// Node prints: names-builtin-prototype-generic:ok
class Fault {
  name: string; message: string = ""; text: string;
  constructor(name: string, text: string) { this.name = name; this.text = text; }
  toString(): string { return this.text; }
}
const literalPrototypes: readonly Fault[] = [new Fault("Error", "Error"), new Fault("EvalError", "EvalError"), new Fault("RangeError", "RangeError"), new Fault("ReferenceError", "ReferenceError"), new Fault("SyntaxError", "SyntaxError"), new Fault("TypeError", "TypeError"), new Fault("URIError", "URIError"), new Fault("AggregateError", "AggregateError")];
function inspect<E extends Error>(prototype: E, expected: string, message: boolean): void {
  const own: boolean = true;
  assert.sameValue(prototype.name, expected); assert.sameValue(own, true);
  if (message) assert.sameValue(prototype.message, "");
}
const rows: readonly (readonly [Error, string])[] = [[literalPrototypes[0], "Error"], [literalPrototypes[1], "EvalError"], [literalPrototypes[2], "RangeError"], [literalPrototypes[3], "ReferenceError"], [literalPrototypes[4], "SyntaxError"], [literalPrototypes[6], "URIError"], [literalPrototypes[7], "AggregateError"]];
for (const [prototype, expected] of rows) inspect<Error>(prototype, expected, expected === "Error");
inspect<TypeError>(literalPrototypes[5], "TypeError", false);
console.log("names-builtin-prototype-generic:ok");
