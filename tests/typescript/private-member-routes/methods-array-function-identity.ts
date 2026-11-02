/*---
description: Private methods read through a class array are one function across all instances of one class evaluation.
features: [ts-private-member-routes, ts-private-member-route-methods, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-tuples, ts-function-types, ts-this-parameter, ts-this, ts-inheritance, ts-private-fields]
---*/
// MethodOwner and Child instances cross typed array elements; node returns the same method function and uses each supplied receiver.
class MethodOwner {
  #value: unknown;
  constructor(value: unknown) { this.#value = value; }
  #read(): unknown { return this.#value; }
  reader(): (this: object) => unknown { return this.#read; }
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
