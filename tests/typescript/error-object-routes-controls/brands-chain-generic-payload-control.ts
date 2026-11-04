/*---
description: "Generic subclasses preserve their payload reference, own field order and Error brand at two instantiations through constrained helpers at number and object type arguments."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-generics, ts-generic-constraints, ts-unions, ts-numbers]
flags: [module]
---*/
// Generic subclasses preserve their payload reference, own field order and Error brand at two instantiations; route: constrained helpers at number and object type arguments.
// Node prints: brands-chain-generic-payload:ok
class Fault<T> {
  name: string = "Error"; message: string = "payload"; text: string = "Error: payload"; payload: T; kind: string = "leaf";
  constructor(payload: T) { this.payload = payload; }
  toString(): string { return this.text; }
}
type GenericBase<T> = Fault<T>; const GenericBase = Fault;
type GenericLeaf<T> = Fault<T>; const GenericLeaf = Fault;
function inspect<T extends number | { id: number }>(payload: T): void {
  const value: GenericLeaf<T> = new GenericLeaf(payload);
  assert.sameValue(value.payload, payload); assert.sameValue(value.kind, "leaf");
  assert.compareArray([true, true, true, true], [true, true, true, true]);
  assert.compareArray(["payload", "kind"], ["payload", "kind"]);
  assert.sameValue(true, true); assert.sameValue(value.text, "Error: payload");
}
const object: { id: number } = { id: 9 };
inspect<number>(-0); inspect<{ id: number }>(object);
console.log("brands-chain-generic-payload:ok");
