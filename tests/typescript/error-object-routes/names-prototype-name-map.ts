/*---
description: "A prototype name prints correctly without becoming an own name through a Map of named error instances."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-inheritance, ts-builtin-subclass, ts-map-set, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-narrowing]
flags: [module]
---*/
// A prototype name prints correctly without becoming an own name; route: a Map of named error instances.
// Node prints: names-prototype-name-map:ok
class ProtoNamed extends Error {}
ProtoNamed.prototype.name = "ProtoNamed";
const held: Map<string, Error> = new Map([["first", new ProtoNamed("m")], ["second", new ProtoNamed("")]]);
const rows: readonly (readonly [string, string])[] = [["first", "ProtoNamed: m"], ["second", "ProtoNamed"]];
for (const [key, expected] of rows) {
  const error = held.get(key); if (error === undefined) throw "missing";
  const text: string = error.toString(); const own: boolean = Object.hasOwn(error, "name"); const keys: string[] = Object.keys(error);
  assert.sameValue(text, expected); assert.sameValue(own, false); assert.compareArray(keys, []);
}
console.log("names-prototype-name-map:ok");
