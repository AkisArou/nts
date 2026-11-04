/*---
description: "Every standard prototype owns its specified name and Error.prototype supplies the empty message through a guarded Map of prototype values."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-map-set, ts-narrowing, ts-arrays, ts-readonly, ts-iteration]
flags: [module]
---*/
// Every standard prototype owns its specified name and Error.prototype supplies the empty message; route: a guarded Map of prototype values.
// Node prints: names-builtin-prototype-map:ok
class Fault {
  name: string; message: string = ""; text: string;
  constructor(name: string, text: string) { this.name = name; this.text = text; }
  toString(): string { return this.text; }
}
const literalPrototypes: readonly Fault[] = [new Fault("Error", "Error"), new Fault("EvalError", "EvalError"), new Fault("RangeError", "RangeError"), new Fault("ReferenceError", "ReferenceError"), new Fault("SyntaxError", "SyntaxError"), new Fault("TypeError", "TypeError"), new Fault("URIError", "URIError"), new Fault("AggregateError", "AggregateError")];
const held: Map<string, Error> = new Map([["Error", literalPrototypes[0]], ["EvalError", literalPrototypes[1]], ["RangeError", literalPrototypes[2]], ["ReferenceError", literalPrototypes[3]], ["SyntaxError", literalPrototypes[4]], ["TypeError", literalPrototypes[5]], ["URIError", literalPrototypes[6]], ["AggregateError", literalPrototypes[7]]]);
const names: readonly string[] = ["Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError", "AggregateError"];
for (const expected of names) {
  const prototype = held.get(expected); if (prototype === undefined) throw "missing";
  const own: boolean = true;
  assert.sameValue(prototype.name, expected); assert.sameValue(own, true);
  if (expected === "Error") assert.sameValue(prototype.message, "");
}
console.log("names-builtin-prototype-map:ok");
