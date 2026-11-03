/*---
description: A generic base-class parameter reads an inherited TypeScript-protected getter through a literal key with current receiver state.
features: [ts-type-form-routes, ts-type-form-route-signatures, ts-protected, ts-class, ts-class-fields, ts-inheritance, ts-accessors, ts-functions, ts-generics, ts-arrays, ts-tuples, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// The generic read parameter carries Child to the protected literal-key getter; node returns the live payload and logs each getter value exactly once.
const log: unknown[] = [];
class Parent {
  payload: unknown;
  constructor(payload: unknown) { this.payload = payload; }
  protected get current(): unknown { log.push(this.payload); return this.payload; }
}
class Child extends Parent {}
function read<T extends Parent>(value: T): unknown { return value["current"]; }
const token = { id: 1 };
const entries: [unknown, string][] = [[undefined, "undefined"], [null, "object"], [false, "boolean"],
  [-0, "number"], [NaN, "number"], [0n, "bigint"], ["tail", "string"], [token, "object"]];
for (const [payload, kind] of entries) {
  log.length = 0;
  const cell = new Child(payload), first = read(cell), replacement = { payload };
  assert.sameValue(first, payload); assert.sameValue(typeof first, kind);
  cell.payload = replacement;
  const second = read(cell);
  assert.sameValue(second, replacement); assert.sameValue(typeof second, "object");
  assert.compareArray(log, [payload, replacement]);
}
