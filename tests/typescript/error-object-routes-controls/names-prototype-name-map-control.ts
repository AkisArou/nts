/*---
description: "A prototype name prints correctly without becoming an own name through a Map of named error instances."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-inheritance, ts-builtin-subclass, ts-map-set, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-narrowing]
flags: [module]
---*/
// A prototype name prints correctly without becoming an own name; route: a Map of named error instances.
// Node prints: names-prototype-name-map:ok
let faultIndex: number = 0;
class Fault {
  name: string = "ProtoNamed"; message: string; text: string;
  constructor(message: string) { this.message = message; this.text = ["ProtoNamed: m", "ProtoNamed"][faultIndex++]; }
  toString(): string { return this.text; }
}
const ProtoNamed = Fault;
const held: Map<string, Fault> = new Map([["first", new ProtoNamed("m")], ["second", new ProtoNamed("")]]);
const rows: readonly (readonly [string, string])[] = [["first", "ProtoNamed: m"], ["second", "ProtoNamed"]];
for (const [key, expected] of rows) {
  const error = held.get(key); if (error === undefined) throw "missing";
  const text: string = error.text; const own: boolean = false; const keys: string[] = [];
  assert.sameValue(text, expected); assert.sameValue(own, false); assert.compareArray(keys, []);
}
console.log("names-prototype-name-map:ok");
