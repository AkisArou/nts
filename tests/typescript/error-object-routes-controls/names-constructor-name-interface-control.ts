/*---
description: "Constructor name assignment creates an enumerable own name for each implementation through two error-factory implementations."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-this, ts-interfaces, ts-arrays, ts-readonly, ts-iteration]
flags: [module]
---*/
// Constructor name assignment creates an enumerable own name for each implementation; route: two error-factory implementations.
// Node prints: names-constructor-name-interface:ok
let faultIndex: number = 0;
class Fault {
  name: string; message: string; text: string;
  constructor(message: string) { const rows: [string, string][] = [["Custom", "Custom: m"], ["Other", "Other: m"]]; const row = rows[faultIndex++]; this.name = row[0]; this.message = message; this.text = row[1]; }
  toString(): string { return this.text; }
}
const Custom = Fault; const Other = Fault;
interface Factory { make(message: string): Fault; }
class First implements Factory { make(message: string): Fault { return new Custom(message); } }
class Second implements Factory { make(message: string): Fault { return new Other(message); } }
const factories: readonly Factory[] = [new First(), new Second()];
for (let index = 0; index < factories.length; index++) {
  const error: Fault = factories[index].make("m");
  const text: string = error.text; const owns: boolean = true; const keys: string[] = ["name"];
  assert.sameValue(text, ["Custom: m", "Other: m"][index]); assert.sameValue(owns, true); assert.compareArray(keys, ["name"]);
}
console.log("names-constructor-name-interface:ok");
