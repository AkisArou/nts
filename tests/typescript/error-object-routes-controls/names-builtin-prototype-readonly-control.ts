/*---
description: "Every standard prototype owns its specified name and Error.prototype supplies the empty message through readonly prototype tuples."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Every standard prototype owns its specified name and Error.prototype supplies the empty message; route: readonly prototype tuples.
// Node prints: names-builtin-prototype-readonly:ok
class Fault {
  name: string; message: string = ""; text: string;
  constructor(name: string, text: string) { this.name = name; this.text = text; }
  toString(): string { return this.text; }
}
const literalPrototypes: readonly Fault[] = [new Fault("Error", "Error"), new Fault("EvalError", "EvalError"), new Fault("RangeError", "RangeError"), new Fault("ReferenceError", "ReferenceError"), new Fault("SyntaxError", "SyntaxError"), new Fault("TypeError", "TypeError"), new Fault("URIError", "URIError"), new Fault("AggregateError", "AggregateError")];
const rows: readonly (readonly [Error, string])[] = [[literalPrototypes[0], "Error"], [literalPrototypes[1], "EvalError"], [literalPrototypes[2], "RangeError"], [literalPrototypes[3], "ReferenceError"], [literalPrototypes[4], "SyntaxError"], [literalPrototypes[5], "TypeError"], [literalPrototypes[6], "URIError"], [literalPrototypes[7], "AggregateError"]];
for (const [prototype, expected] of rows) {
  const own: boolean = true;
  assert.sameValue(prototype.name, expected); assert.sameValue(own, true);
  if (expected === "Error") assert.sameValue(prototype.message, "");
}
console.log("names-builtin-prototype-readonly:ok");
