/*---
description: A private method called through a generic structural helper returns its exact receiver beside its private payload.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-this, ts-tuples, ts-interfaces, ts-generics, ts-generic-constraints, ts-inheritance, ts-private-fields]
---*/
// SnapshotOwner instances cross a constrained generic parameter; node preserves method this and the payload identity in the returned tuple.
class SnapshotOwner {
  #value: unknown;
  constructor(value: unknown) { this.#value = value; }
  #snapshot(): [object, unknown] { return [this, this.#value]; }
  snapshot(): [object, unknown] { return this.#snapshot(); }
}
interface Port { snapshot(): [object, unknown]; }
class Child extends SnapshotOwner { extra: number = 7; }
function inspect<T extends Port>(owner: T): [object, unknown] { return owner.snapshot(); }
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const first = new SnapshotOwner(value), child = new Child(value);
  const entries: Port[] = [child, first, child];
  for (const entry of entries) {
    const result = inspect(entry); assert.sameValue(result.length, 2); assert.sameValue(result[0], entry); assert.sameValue(result[1], value);
  }
  const result = inspect(child); assert.sameValue(result[0], child); assert.sameValue(result[1], value); assert.sameValue(child.extra, 7);
}
