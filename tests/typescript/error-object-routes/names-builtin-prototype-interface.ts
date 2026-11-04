/*---
description: "Either reader preserves all standard prototype names and the Error prototype empty message through two interface implementations with direct and held receivers."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-unions, ts-null-undefined, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// Either reader preserves all standard prototype names and the Error prototype empty message; route: two interface implementations with direct and held receivers.
// Node prints: names-builtin-prototype-interface:ok
interface Reader { read(prototype: Error, message: boolean): [string, boolean, string | undefined]; }
class DirectReader implements Reader {
  read(prototype: Error, message: boolean): [string, boolean, string | undefined] { return [prototype.name, Object.hasOwn(prototype, "name"), message ? prototype.message : undefined]; }
}
class HeldReader implements Reader {
  value: Error | undefined;
  read(prototype: Error, message: boolean): [string, boolean, string | undefined] { this.value = prototype; return [this.value.name, Object.hasOwn(this.value, "name"), message ? this.value.message : undefined]; }
}
const readers: readonly Reader[] = [new DirectReader(), new HeldReader()];
const rows: readonly (readonly [Error, string])[] = [[Error.prototype, "Error"], [EvalError.prototype, "EvalError"], [RangeError.prototype, "RangeError"], [ReferenceError.prototype, "ReferenceError"], [SyntaxError.prototype, "SyntaxError"], [TypeError.prototype, "TypeError"], [URIError.prototype, "URIError"], [AggregateError.prototype, "AggregateError"]];
for (const [prototype, expected] of rows) for (const reader of readers) {
  const [name, own, message] = reader.read(prototype, expected === "Error");
  assert.sameValue(name, expected); assert.sameValue(own, true); assert.sameValue(message, expected === "Error" ? "" : undefined);
}
console.log("names-builtin-prototype-interface:ok");
