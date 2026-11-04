/*---
description: "Two factory implementations preserve forwarded cause identity and distinct own field layouts through an interface with two implementations."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-interfaces, ts-type-aliases, ts-intersections, ts-unknown, ts-override]
flags: [module]
---*/
// Two factory implementations preserve forwarded cause identity and distinct own field layouts; route: an interface with two implementations.
// Node prints: brands-super-cause-interface:ok
class FirstFault extends Error {
  code: string = "plain";
  constructor(message: string, cause: unknown) { super(message, { cause }); }
}
class SecondFault extends Error {
  override name: string = "NamedFault"; code: string = "named";
  constructor(message: string, cause: unknown) { super(message, { cause }); }
}
type Made = Error & { code: string };
interface Maker { make(message: string, cause: unknown): Made; }
class FirstMaker implements Maker { make(message: string, cause: unknown): Made { return new FirstFault(message, cause); } }
class SecondMaker implements Maker { make(message: string, cause: unknown): Made { return new SecondFault(message, cause); } }
const makers: readonly Maker[] = [new FirstMaker(), new SecondMaker()];
const reasons: readonly unknown[] = [{ id: 4 }, undefined];
const names: readonly string[] = ["Error", "NamedFault"], codes: readonly string[] = ["plain", "named"];
const texts: readonly string[] = ["Error: maker", "NamedFault: maker"];
const keys: readonly (readonly string[])[] = [["code"], ["name", "code"]];
for (let index = 0; index < makers.length; index++) {
  const value: Made = makers[index].make("maker", reasons[index]);
  assert.sameValue(value.cause, reasons[index]); assert.sameValue(value.code, codes[index]);
  assert.sameValue(value.name, names[index]); assert.sameValue(value.message, "maker");
  assert.sameValue(Object.hasOwn(value, "cause"), true); assert.sameValue(Object.hasOwn(value, "message"), true);
  assert.compareArray(Object.keys(value), keys[index]);
  assert.compareArray([value instanceof Error, Error.isError(value)], [true, true]);
  assert.sameValue(String(value), texts[index]);
}
console.log("brands-super-cause-interface:ok");
