/*---
description: Cloning a stamped plain object through a tuple drops the private brand independently of its prototype (Map control).
features: [ts-private-member-routes, ts-private-member-route-views, ts-map-set, ts-class, ts-class-fields, ts-inheritance, ts-interfaces, ts-tuples, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-errors, ts-narrowing]
---*/
// PublicStamp adds state to returned targets carried in typed tuples; node clones their public data and drops the stamp even though originals are not PublicStamp instances.
interface StampView { label: string; value: number; }
class ReturnPublic { constructor(target: object) { return target; } }
const publicStamps = new Map<object, unknown>();
class PublicStamp extends ReturnPublic {
  constructor(target: object, secret: unknown) { super(target); if (publicStamps.has(this)) throw new TypeError(); publicStamps.set(this, secret); }
  static owns(value: object): boolean { return publicStamps.has(value); }
  static read(value: object): unknown { if (!publicStamps.has(value)) throw new TypeError(); return publicStamps.get(value); }
}
for (const secret of [undefined, Symbol("private"), { id: 1 }]) {
  const first: StampView = { label: "visible", value: 1 }, second: StampView = { label: "visible", value: 2 };
  const stampedSecond: object = new PublicStamp(second, secret), stampedFirst: object = new PublicStamp(first, secret);
  assert.sameValue(stampedSecond, second); assert.sameValue(stampedFirst, first);
  const rows: [StampView, number][] = [[first, 1], [second, 2], [first, 1]];
  for (const [view, value] of rows) {
    const copy: StampView = structuredClone(view);
    assert.sameValue(view instanceof PublicStamp, false); assert.sameValue(PublicStamp.owns(view), true);
    assert.sameValue(PublicStamp.read(view), secret); assert.notSameValue(copy, view);
    assert.compareArray(Reflect.ownKeys(copy), ["label", "value"]);
    assert.sameValue(copy.label, "visible"); assert.sameValue(copy.value, value);
    assert.sameValue(PublicStamp.owns(copy), false); assert.throws(TypeError, () => PublicStamp.read(copy));
    assert.sameValue(PublicStamp.read(view), secret);
  }
}
