/*---
description: A brand-narrowed union distinguishes an existing undefined-valued private field from absent and unrelated private names. The control uses checked per-name Maps.
features: [ts-private-member-routes, ts-private-member-route-fields, ts-class, ts-class-fields, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-unknown, ts-unions, ts-narrowing, ts-type-guards, ts-inheritance, ts-tuples, ts-map-set]
---*/
// BrandOwner, Other and plain objects cross one union; node brands undefined-valued owner slots and excludes equal-shaped impostors. The control stores each private name in its own checked Map.
const ownerValues = new Map<object, unknown>(), otherValues = new Map<object, unknown>();
class BrandOwner {
  label: string = "same";
  constructor() { ownerValues.set(this, undefined); }
  static owns(target: object): target is BrandOwner { return ownerValues.has(target); }
  read(): unknown { if (!ownerValues.has(this)) throw new TypeError(); return ownerValues.get(this); }
  write(value: unknown): unknown { if (!ownerValues.has(this)) throw new TypeError(); ownerValues.set(this, value); return value; }
}
class Other { label: string = "same"; constructor() { otherValues.set(this, undefined); } read(): unknown { if (!otherValues.has(this)) throw new TypeError(); return otherValues.get(this); } }
class Child extends BrandOwner {}
type Candidate = BrandOwner | Other | { label: string };
const values: unknown[] = [undefined, null, false, -0, NaN, 0n, "", { value: 1 }, [1], () => 1];
for (const value of values) {
  const other = new Other();
  const entries: [Candidate, boolean][] = [[new Child(), true], [{ label: "same" }, false], [other, false], [new BrandOwner(), true]];
  for (const [candidate, expected] of entries) {
    const owns = BrandOwner.owns(candidate); assert.sameValue(owns, expected);
    if (owns) {
      assert.sameValue(candidate.read(), undefined); assert.sameValue(candidate.write(value), value); assert.sameValue(candidate.read(), value);
      assert.sameValue(BrandOwner.owns(candidate), true);
    }
    assert.sameValue(candidate.label, "same");
  }
  assert.sameValue(other.read(), undefined);
}
