/*---
description: A private method called through a generic structural helper returns its exact receiver beside its private payload. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-this, ts-tuples, ts-interfaces, ts-generics, ts-generic-constraints, ts-inheritance, ts-map-set]
---*/
// SnapshotOwner instances cross a constrained generic parameter; node preserves method this and the payload identity in the returned tuple. The control stores each private name in its own checked Map.
const valuesByOwner = new Map<object, unknown>(), methodsByOwner = new Map<object, (this: object) => [object, unknown]>();
function privateSnapshot(this: object): [object, unknown] { if (!valuesByOwner.has(this)) throw new TypeError(); return [this, valuesByOwner.get(this)]; }
class SnapshotOwner {
  constructor(value: unknown) { valuesByOwner.set(this, value); methodsByOwner.set(this, privateSnapshot); }
  snapshot(): [object, unknown] { if (!methodsByOwner.has(this)) throw new TypeError(); const method = methodsByOwner.get(this); if (method === undefined) throw new Error("missing method"); return method.call(this); }
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
