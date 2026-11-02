/*---
description: "WeakSet membership brands constructed instances and rejects equal-shaped or revoked method receivers."
features: [ts-weak-collection-routes, ts-weak-collection-route-set, ts-arrays, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-functions, ts-this-parameter, ts-errors, ts-numbers]
---*/
// A class method checks the WeakSet brand of its typed receiver; node accepts constructed aliases and throws TypeError for equal-shaped or deleted receivers.
const brands: WeakSet<object> = new WeakSet<object>();
class BrandedValue {
  value: number;
  constructor(value: number) { this.value = value; assert.sameValue(brands.add(this), brands); }
  read(this: { value: number }, expectedMember: boolean): number {
    const member = brands.has(this); assert.sameValue(member, expectedMember);
    if (!member) throw new TypeError('unbranded receiver');
    return this.value;
  }
}
for (const value of [-0, 8, NaN]) {
  const first = new BrandedValue(value), peer = new BrandedValue(value), alias = first, fake = { value };
  const read = first.read;
  assert.sameValue(brands.has(first), true); assert.sameValue(brands.has(alias), true); assert.sameValue(brands.has(peer), true);
  assert.sameValue(first.read(true), value); assert.sameValue(alias.read(true), value); assert.sameValue(read.call(peer, true), value);
  assert.sameValue(brands.has(fake), false); assert.sameValue(brands.delete(fake), false);
  assert.throws(TypeError, () => read.call(fake, false));
  assert.sameValue(brands.delete(alias), true); assert.sameValue(brands.delete(first), false);
  assert.sameValue(brands.has(first), false); assert.sameValue(brands.has(alias), false);
  assert.throws(TypeError, () => first.read(false));
  assert.sameValue(brands.has(peer), true); assert.sameValue(peer.read(true), value);
  assert.sameValue(brands.add(first), brands); assert.sameValue(brands.has(alias), true); assert.sameValue(alias.read(true), value);
  assert.sameValue(brands.delete(first), true); assert.sameValue(brands.delete(peer), true);
  assert.sameValue(brands.delete(first), false); assert.sameValue(brands.delete(peer), false);
  assert.sameValue(brands.has(first), false); assert.sameValue(brands.has(peer), false);
}
