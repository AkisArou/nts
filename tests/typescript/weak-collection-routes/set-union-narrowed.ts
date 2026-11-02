/*---
description: "A narrowed collection union preserves WeakSet identity and membership changes."
features: [ts-weak-collection-routes, ts-weak-collection-route-set, ts-arrays, ts-iteration, ts-objects, ts-unions, ts-discriminated-unions, ts-literal-types, ts-narrowing, ts-functions, ts-class, ts-class-fields, ts-tuples]
---*/
// A discriminated union carries a WeakSet until its live arm is selected; node preserves member identity and the expected empty/live branch answers.
class SetKey { value: number; constructor(value: number) { this.value = value; } }
type SetRoute = { kind: 'live'; members: WeakSet<object>; key: object; peer: object } | { kind: 'empty' };
function exercise(route: SetRoute): boolean {
  if (route.kind === 'empty') return false;
  const members = route.members;
  assert.sameValue(members.has(route.key), false); assert.sameValue(members.delete(route.key), false);
  assert.sameValue(members.add(route.key), members); assert.sameValue(members.has(route.key), true);
  assert.sameValue(members.has(route.peer), false); assert.sameValue(members.delete(route.peer), false);
  assert.sameValue(members.add(route.peer), members); assert.sameValue(members.has(route.peer), true);
  assert.sameValue(members.delete(route.key), true); assert.sameValue(members.delete(route.key), false);
  assert.sameValue(members.has(route.key), false); assert.sameValue(members.has(route.peer), true);
  assert.sameValue(members.delete(route.peer), true); assert.sameValue(members.delete(route.peer), false); assert.sameValue(members.has(route.peer), false);
  return true;
}
const pairs: [object, object][] = [[{ id: 7 }, { id: 7 }], [[7], [7]], [() => 7, () => 7], [new SetKey(7), new SetKey(7)]];
for (const [key, peer] of pairs) {
  const routes: SetRoute[] = [{ kind: 'empty' }, { kind: 'live', members: new WeakSet<object>(), key, peer }];
  const answers: boolean[] = [];
  for (const route of routes) answers.push(exercise(route));
  assert.compareArray(answers, [false, true]);
}
