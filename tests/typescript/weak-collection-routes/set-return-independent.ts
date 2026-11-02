/*---
description: "Typed WeakSet returns keep memberships independent even when the collections share a key."
features: [ts-weak-collection-routes, ts-weak-collection-route-set, ts-arrays, ts-iteration, ts-objects, ts-functions, ts-class, ts-class-fields, ts-tuples]
---*/
// A factory returns independently seeded WeakSets; node keeps same-key membership separate across mutations of the returned collections.
class SetKey { value: number; constructor(value: number) { this.value = value; } }
function makeMembers(key: object): WeakSet<object> {
  const members = new WeakSet<object>(); assert.sameValue(members.add(key), members); return members;
}
const pairs: [object, object][] = [[{ id: 4 }, { id: 4 }], [[4], [4]], [() => 4, () => 4], [new SetKey(4), new SetKey(4)]];
for (const [key, peer] of pairs) {
  const first: WeakSet<object> = makeMembers(key), second: WeakSet<object> = makeMembers(key);
  assert.sameValue(first === second, false); assert.sameValue(first.has(key), true); assert.sameValue(second.has(key), true);
  assert.sameValue(first.has(peer), false); assert.sameValue(second.has(peer), false);
  assert.sameValue(first.delete(peer), false); assert.sameValue(second.delete(peer), false);
  assert.sameValue(first.add(peer), first); assert.sameValue(first.has(peer), true); assert.sameValue(second.has(peer), false);
  assert.sameValue(first.delete(key), true); assert.sameValue(first.delete(key), false); assert.sameValue(first.has(key), false);
  assert.sameValue(second.has(key), true);
  assert.sameValue(first.add(key), first); assert.sameValue(first.has(key), true);
  assert.sameValue(second.delete(key), true); assert.sameValue(second.delete(key), false); assert.sameValue(second.has(key), false);
  assert.sameValue(first.has(key), true); assert.sameValue(first.has(peer), true);
  assert.sameValue(first.delete(peer), true); assert.sameValue(first.delete(peer), false); assert.sameValue(first.has(peer), false);
}
