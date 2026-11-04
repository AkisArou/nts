/*---
description: "Constructor name assignment creates an enumerable own name for each implementation through two error-factory implementations."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-this, ts-interfaces, ts-arrays, ts-readonly, ts-iteration]
flags: [module]
---*/
// Constructor name assignment creates an enumerable own name for each implementation; route: two error-factory implementations.
// Node prints: names-constructor-name-interface:ok
class Custom extends Error { constructor(message: string) { super(message); this.name = "Custom"; } }
class Other extends Error { constructor(message: string) { super(message); this.name = "Other"; } }
interface Factory { make(message: string): Error; }
class First implements Factory { make(message: string): Error { return new Custom(message); } }
class Second implements Factory { make(message: string): Error { return new Other(message); } }
const factories: readonly Factory[] = [new First(), new Second()];
for (let index = 0; index < factories.length; index++) {
  const error: Error = factories[index].make("m");
  const text: string = String(error); const owns: boolean = Object.hasOwn(error, "name"); const keys: string[] = Object.keys(error);
  assert.sameValue(text, ["Custom: m", "Other: m"][index]); assert.sameValue(owns, true); assert.compareArray(keys, ["name"]);
}
console.log("names-constructor-name-interface:ok");
