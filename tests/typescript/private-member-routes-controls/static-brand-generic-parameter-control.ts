/*---
description: A generic object parameter distinguishes a static private brand from instance and subclass shapes. Control with explicit constructor checks.
features: [ts-private-member-routes, ts-private-member-route-static, ts-class, ts-static, ts-functions, ts-arrays, ts-iteration, ts-errors, ts-inheritance, ts-generics, ts-generic-constraints, ts-objects, ts-tuples, ts-unknown]
---*/
// StaticBrand and Unrelated constructors cross an object-constrained parameter; node brands only the declaring constructor, never its instances or subclasses.
const ownerValue: unknown = undefined, otherValue: unknown = undefined;
class StaticBrand {
  static owns(value: object): boolean { return value === StaticBrand; }
  static read(): unknown { if (this !== StaticBrand) throw new TypeError(); return ownerValue; }
}
class StaticChild extends StaticBrand {}
class Unrelated {
  static owns(value: object): boolean { return value === Unrelated; }
  static read(): unknown { if (this !== Unrelated) throw new TypeError(); return otherValue; }
}
function branded<T extends object>(value: T): [boolean, boolean] { return [StaticBrand.owns(value), Unrelated.owns(value)]; }
const alias: object = StaticBrand;
const entries: [object, boolean, boolean][] = [
  [StaticBrand, true, false], [StaticChild, false, false], [Unrelated, false, true],
  [new StaticBrand(), false, false], [new StaticChild(), false, false],
  [new Unrelated(), false, false], [{ value: undefined }, false, false], [alias, true, false],
];
for (const [receiver, owner, other] of entries) {
  assert.compareArray(branded(receiver), [owner, other]);
  assert.sameValue(StaticBrand.read(), undefined); assert.sameValue(Unrelated.read(), undefined);
}
assert.sameValue(alias, StaticBrand);
