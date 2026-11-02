/*---
description: "A typed key tuple used by the WeakSet constructor keeps repeated aliases and separate object identities."
features: [ts-weak-collection-routes, ts-weak-collection-route-set, ts-arrays, ts-iteration, ts-objects, ts-tuples, ts-functions, ts-class, ts-class-fields]
---*/
// A tuple supplies WeakSet constructor keys including an alias; node retains the two distinct identities and excludes an equal-content third object.
class SetKey { value: number; constructor(value: number) { this.value = value; } }
const triples: [object, object, object][] = [[{ id: 6 }, { id: 6 }, { id: 6 }], [[6], [6], [6]], [() => 6, () => 6, () => 6], [new SetKey(6), new SetKey(6), new SetKey(6)]];
for (const [key, peer, absent] of triples) {
  const alias = key, route: [object, object, object] = [key, alias, peer];
  const members: WeakSet<object> = new WeakSet<object>(route);
  assert.sameValue(members.has(key), true); assert.sameValue(members.has(alias), true); assert.sameValue(members.has(peer), true);
  assert.sameValue(members.has(absent), false); assert.sameValue(members.delete(absent), false);
  assert.sameValue(members.add(alias), members); assert.sameValue(members.has(key), true);
  assert.sameValue(members.delete(key), true); assert.sameValue(members.delete(alias), false);
  assert.sameValue(members.has(key), false); assert.sameValue(members.has(alias), false); assert.sameValue(members.has(peer), true);
  assert.sameValue(members.add(alias), members); assert.sameValue(members.has(key), true);
  assert.sameValue(members.delete(peer), true); assert.sameValue(members.delete(peer), false); assert.sameValue(members.has(peer), false);
  assert.sameValue(members.has(key), true);
  assert.sameValue(route[0], key); assert.sameValue(route[1], key); assert.sameValue(route[2], peer);
}
