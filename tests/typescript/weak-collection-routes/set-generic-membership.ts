/*---
description: "An object-constrained generic WeakSet helper preserves aliases and separate peers at multiple instantiations."
features: [ts-weak-collection-routes, ts-weak-collection-route-set, ts-arrays, ts-iteration, ts-objects, ts-generics, ts-generic-constraints, ts-functions, ts-class, ts-class-fields, ts-numbers]
---*/
// WeakSet<T> is created in an object-constrained generic helper; node retains each instantiated object's identity through duplicate adds and deletion.
class SetKey { value: number; constructor(value: number) { this.value = value; } }
function exercise<T extends object>(key: T, alias: T, peer: T): void {
  const members: WeakSet<T> = new WeakSet<T>();
  assert.sameValue(key, alias); assert.sameValue(key === peer, false);
  assert.sameValue(members.has(key), false); assert.sameValue(members.delete(key), false);
  assert.sameValue(members.add(key), members); assert.sameValue(members.add(alias), members); assert.sameValue(members.has(alias), true);
  assert.sameValue(members.has(peer), false); assert.sameValue(members.delete(peer), false);
  assert.sameValue(members.add(peer), members); assert.sameValue(members.has(peer), true);
  assert.sameValue(members.delete(alias), true); assert.sameValue(members.delete(key), false);
  assert.sameValue(members.has(key), false); assert.sameValue(members.has(alias), false); assert.sameValue(members.has(peer), true);
  assert.sameValue(members.add(alias), members); assert.sameValue(members.has(key), true);
  assert.sameValue(members.delete(peer), true); assert.sameValue(members.delete(peer), false); assert.sameValue(members.has(peer), false);
  assert.sameValue(members.has(key), true);
}
for (const value of [-0, 5, NaN]) {
  const record = { value }, array = [value], callback = () => value, instance = new SetKey(value);
  exercise(record, record, { value }); exercise(array, array, [value]);
  exercise(callback, callback, () => value); exercise(instance, instance, new SetKey(value));
}
