/*---
description: A nested class returned as an interface reads and writes the enclosing class private names on either legitimate instance.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-interfaces, ts-class-expression, ts-functions, ts-unknown, ts-unsound-bivariance, ts-private-fields]
---*/
// OuterVault returns a nested class as Lens; node uses the enclosing private name for both instances and rejects the equal-shaped plain object.
interface Lens { owns(target: object): boolean; read(target: object): unknown; write(target: object, value: unknown): unknown; }
class OuterVault {
  label: string = "same"; #value: unknown;
  constructor(value: unknown) { this.#value = value; }
  lens(): Lens {
    return new class {
      owns(target: object): boolean { return #value in target; }
      read(target: OuterVault): unknown { return target.#value; }
      write(target: OuterVault, value: unknown): unknown { return target.#value = value; }
    }();
  }
}
for (const value of [undefined, -0, "", { value: 1 }]) {
  const second = new OuterVault(value), first = new OuterVault(value), lens: Lens = first.lens(), next = { value };
  const sources: object[] = [first, second, first, { label: "same" }];
  for (let index = 0; index < sources.length; index++) {
    const target: object = sources[index];
    assert.sameValue(lens.owns(target), index < 3);
    if (index < 3) {
      assert.sameValue(lens.read(target), value); assert.sameValue(lens.write(target, next), next);
      assert.sameValue(lens.read(target), next); assert.sameValue(lens.write(target, value), value);
      assert.sameValue(lens.read(target), value);
    } else { assert.throws(TypeError, () => lens.read(target)); assert.throws(TypeError, () => lens.write(target, next)); }
  }
  assert.sameValue(lens.read(first), value); assert.sameValue(lens.read(second), value);
}
