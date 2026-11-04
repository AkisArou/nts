/*---
description: "Either reader preserves all standard prototype names and the Error prototype empty message through two interface implementations with direct and held receivers."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-unions, ts-null-undefined, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Either reader preserves all standard prototype names and the Error prototype empty message; route: two interface implementations with direct and held receivers.
// Node prints: names-builtin-prototype-interface:ok
class Fault {
  name: string; message: string = ""; text: string;
  constructor(name: string, text: string) { this.name = name; this.text = text; }
  toString(): string { return this.text; }
}
const literalPrototypes: readonly Fault[] = [new Fault("Error", "Error"), new Fault("EvalError", "EvalError"), new Fault("RangeError", "RangeError"), new Fault("ReferenceError", "ReferenceError"), new Fault("SyntaxError", "SyntaxError"), new Fault("TypeError", "TypeError"), new Fault("URIError", "URIError"), new Fault("AggregateError", "AggregateError")];
interface Reader { read(prototype: Error, message: boolean): [string, boolean, string | undefined]; }
class DirectReader implements Reader {
  read(prototype: Error, message: boolean): [string, boolean, string | undefined] { return [prototype.name, true, message ? prototype.message : undefined]; }
}
class HeldReader implements Reader {
  value: Error | undefined;
  read(prototype: Error, message: boolean): [string, boolean, string | undefined] { this.value = prototype; return [this.value.name, true, message ? this.value.message : undefined]; }
}
const readers: readonly Reader[] = [new DirectReader(), new HeldReader()];
const rows: readonly (readonly [Error, string])[] = [[literalPrototypes[0], "Error"], [literalPrototypes[1], "EvalError"], [literalPrototypes[2], "RangeError"], [literalPrototypes[3], "ReferenceError"], [literalPrototypes[4], "SyntaxError"], [literalPrototypes[5], "TypeError"], [literalPrototypes[6], "URIError"], [literalPrototypes[7], "AggregateError"]];
for (const [prototype, expected] of rows) for (const reader of readers) {
  const [name, own, message] = reader.read(prototype, expected === "Error");
  assert.sameValue(name, expected); assert.sameValue(own, true); assert.sameValue(message, expected === "Error" ? "" : undefined);
}
console.log("names-builtin-prototype-interface:ok");
