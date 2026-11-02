/*---
description: "Control for set-parameter-return-chain: Each Set add result carried from a typed parameter remains the same collection across repeated and new members."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-set, ts-arrays, ts-iteration, ts-objects, ts-functions, ts-class, ts-class-fields, ts-tuples]
---*/
// A Set parameter carries each add result into the next call; node returns the original set at every link, including a duplicate add.
class SetKey { value: number; constructor(value: number) { this.value = value; } }
function exercise(members: Set<object>, first: object, second: object): void {
  const one: Set<object> = members.add(first); assert.sameValue(one, members);
  assert.sameValue(one.has(first), true); assert.sameValue(one.has(second), false); assert.sameValue(one.delete(second), false);
  const two: Set<object> = one.add(second); assert.sameValue(two, members);
  const three: Set<object> = two.add(first); assert.sameValue(three, members);
  assert.sameValue(three.has(first), true); assert.sameValue(three.has(second), true);
  assert.sameValue(three.delete(first), true); assert.sameValue(two.delete(first), false);
  assert.sameValue(one.has(first), false); assert.sameValue(members.has(second), true);
  assert.sameValue(one.add(first), members); assert.sameValue(two.has(first), true);
  assert.sameValue(two.delete(second), true); assert.sameValue(one.delete(second), false);
  assert.sameValue(members.has(second), false); assert.sameValue(three.has(first), true);
}
const pairs: [object, object][] = [[{ id: 3 }, { id: 3 }], [[3], [3]], [() => 3, () => 3], [new SetKey(3), new SetKey(3)]];
for (const [first, second] of pairs) exercise(new Set<object>(), first, second);
