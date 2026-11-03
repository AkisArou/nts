/*---
description: Constructor tuples read inherited TypeScript-protected static fields and preserve subclass shadow writes without changing the base.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-protected, ts-class, ts-class-fields, ts-static, ts-inheritance, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// A typed constructor tuple carries protected current; node reads the inherited payload, then only the subclass sees its own replacement object.
const token = { id: 1 };
const entries: [unknown, string][] = [[undefined, "undefined"], [null, "object"], [false, "boolean"],
  [-0, "number"], [NaN, "number"], [0n, "bigint"], ["tail", "string"], [token, "object"]];
for (const [payload, kind] of entries) {
  class Parent { protected static current: unknown = payload; }
  class Child extends Parent {}
  const constructors: [typeof Parent, typeof Child] = [Parent, Child];
  assert.notSameValue(constructors[0], constructors[1]);
  assert.sameValue(typeof constructors[0], "function"); assert.sameValue(typeof constructors[1], "function");
  assert.sameValue(constructors[0]["current"], payload); assert.sameValue(typeof constructors[0]["current"], kind);
  assert.sameValue(constructors[1]["current"], payload); assert.sameValue(typeof constructors[1]["current"], kind);
  const replacement = { payload };
  constructors[1]["current"] = replacement;
  assert.sameValue(constructors[1]["current"], replacement); assert.sameValue(typeof constructors[1]["current"], "object");
  assert.sameValue(constructors[0]["current"], payload); assert.sameValue(typeof constructors[0]["current"], kind);
}
