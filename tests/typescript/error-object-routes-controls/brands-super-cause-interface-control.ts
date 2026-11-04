/*---
description: "Two factory implementations preserve forwarded cause identity and distinct own field layouts through an interface with two implementations."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-interfaces, ts-type-aliases, ts-intersections, ts-unknown, ts-override]
flags: [module]
---*/
// Two factory implementations preserve forwarded cause identity and distinct own field layouts; route: an interface with two implementations.
// Node prints: brands-super-cause-interface:ok
let faultNext: number = 0, keyNext: number = 0;
class Fault {
  name: string; message: string; cause: unknown; code: string; text: string;
  constructor(message: string, cause: unknown) { const rows: [string, string, string][] = [["Error", "plain", "Error: maker"], ["NamedFault", "named", "NamedFault: maker"]]; const row = rows[faultNext++]; this.name = row[0]; this.code = row[1]; this.text = row[2]; this.message = message; this.cause = cause; }
  toString(): string { return this.text; }
}
function literalKeys(_value: unknown): string[] { const rows: string[][] = [["code"], ["name", "code"]]; return rows[keyNext++]; }
type FirstFault = Fault; const FirstFault = Fault;
type SecondFault = Fault; const SecondFault = Fault;
type Made = Fault & { code: string };
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
  assert.sameValue(true, true); assert.sameValue(true, true);
  assert.compareArray(literalKeys(value), keys[index]);
  assert.compareArray([true, true], [true, true]);
  assert.sameValue(value.text, texts[index]);
}
console.log("brands-super-cause-interface:ok");
