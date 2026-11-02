/*---
description: "WeakSet interface fields retain aliases and keep equal-content object members distinct."
features: [ts-weak-collection-routes, ts-weak-collection-route-set, ts-arrays, ts-iteration, ts-objects, ts-interfaces, ts-functions, ts-class, ts-class-fields, ts-tuples]
---*/
// A WeakSet and its keys cross interface fields; node matches aliases, rejects equal-content peers until added and deletes each identity once.
class SetKey { value: number; constructor(value: number) { this.value = value; } }
interface SetRoute { members: WeakSet<object>; key: object; alias: object; peer: object; }
const pairs: [object, object][] = [[{ id: 1 }, { id: 1 }], [[1], [1]], [() => 1, () => 1], [new SetKey(1), new SetKey(1)]];
for (const [key, peer] of pairs) {
  const route: SetRoute = { members: new WeakSet<object>(), key, alias: key, peer };
  assert.sameValue(route.key, route.alias); assert.sameValue(route.key === route.peer, false);
  assert.sameValue(route.members.has(route.key), false); assert.sameValue(route.members.delete(route.key), false);
  assert.sameValue(route.members.add(route.key), route.members); assert.sameValue(route.members.has(route.alias), true);
  assert.sameValue(route.members.add(route.alias), route.members); assert.sameValue(route.members.has(route.key), true);
  assert.sameValue(route.members.has(route.peer), false); assert.sameValue(route.members.delete(route.peer), false);
  assert.sameValue(route.members.add(route.peer), route.members); assert.sameValue(route.members.has(route.peer), true);
  assert.sameValue(route.members.delete(route.alias), true); assert.sameValue(route.members.delete(route.key), false);
  assert.sameValue(route.members.has(route.alias), false); assert.sameValue(route.members.has(route.key), false);
  assert.sameValue(route.members.has(route.peer), true);
  assert.sameValue(route.members.add(route.key), route.members); assert.sameValue(route.members.has(route.alias), true);
  assert.sameValue(route.members.delete(route.peer), true); assert.sameValue(route.members.delete(route.peer), false);
  assert.sameValue(route.members.has(route.peer), false); assert.sameValue(route.members.has(route.key), true);
}
