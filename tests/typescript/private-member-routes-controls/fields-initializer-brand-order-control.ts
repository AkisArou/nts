/*---
description: A private brand is absent before its field initialization and present after construction through a class parameter. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-inheritance, ts-map-set]
---*/
// OrderedOwner instances cross an inspect parameter; node reports false for the captured early brand and true for the completed instance. The control stores each private name in its own checked Map.
const beforeValues = new Map<object, boolean>(), laterValues = new Map<object, unknown>();
class OrderedOwner {
  constructor(value: unknown) { beforeValues.set(this, this.hasLater()); laterValues.set(this, undefined); if (!laterValues.has(this)) throw new TypeError(); laterValues.set(this, value); }
  hasLater(): boolean { return laterValues.has(this); }
  before(): boolean { if (!beforeValues.has(this)) throw new TypeError(); const value = beforeValues.get(this); if (value === undefined) throw new Error("missing value"); return value; }
  read(): unknown { if (!laterValues.has(this)) throw new TypeError(); return laterValues.get(this); }
}
class Child extends OrderedOwner {}
function inspect(owner: OrderedOwner, expected: unknown): void {
  assert.sameValue(owner.before(), false); assert.sameValue(owner.hasLater(), true); assert.sameValue(owner.read(), expected);
}
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const entries: OrderedOwner[] = [new Child(value), new OrderedOwner(value), new Child(value)];
  for (const entry of entries) inspect(entry, value);
}
