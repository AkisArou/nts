/*---
description: Private methods read through a class array are one function across all instances of one class evaluation. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-tuples, ts-function-types, ts-this-parameter, ts-this, ts-inheritance, ts-map-set]
---*/
// MethodOwner and Child instances cross typed array elements; node returns the same method function and uses each supplied receiver. The control stores each private name in its own checked Map.
const valuesByOwner = new Map<object, unknown>(), methodsByOwner = new Map<object, (this: object) => unknown>();
function privateRead(this: object): unknown { if (!valuesByOwner.has(this)) throw new TypeError(); return valuesByOwner.get(this); }
class MethodOwner {
  constructor(value: unknown) { valuesByOwner.set(this, value); methodsByOwner.set(this, privateRead); }
  reader(): (this: object) => unknown { if (!methodsByOwner.has(this)) throw new TypeError(); const method = methodsByOwner.get(this); if (method === undefined) throw new Error("missing method"); return method; }
}
class Child extends MethodOwner {}
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const first = new MethodOwner(value), marker = { value }, second = new Child(marker), third = new MethodOwner(undefined);
  const shared = first.reader();
  const entries: [MethodOwner, unknown][] = [[second, marker], [first, value], [third, undefined], [first, value]];
  for (const [owner, expected] of entries) {
    const method: (this: object) => unknown = owner.reader();
    assert.sameValue(method, shared); assert.sameValue(method.call(owner), expected);
  }
}
