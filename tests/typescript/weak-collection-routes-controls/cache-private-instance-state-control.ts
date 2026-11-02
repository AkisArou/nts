/*---
description: "Strong-collection control for cache-private-instance-state: A module-private Map keeps state distinct for equal-shaped class instances and shared through an instance alias."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-caches, ts-class, ts-class-fields, ts-interfaces, ts-modules, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-null-undefined, ts-symbols, ts-functions]
flags: [module]
---*/
// Map keys travel as method receivers; node returns each exact private state, preserves aliases and removes only the deleted instance.
interface PrivateState { total: number; payload: unknown; }
const privateStates: Map<StateOwner, PrivateState> = new Map();
class StateOwner {
  constructor(state: PrivateState) { assert.sameValue(privateStates.set(this, state), privateStates); }
  read(): PrivateState | undefined { return privateStates.get(this); }
  present(): boolean { return privateStates.has(this); }
  remove(): boolean { return privateStates.delete(this); }
}
class StatePayload { marker: number = 1; }
const payloads: unknown[] = [undefined, null, false, -0, NaN, 0n, "", Symbol("state"), {}, [], () => 7, new StatePayload()];
for (const payload of payloads) {
  const firstState: PrivateState = { total: 0, payload }, secondState: PrivateState = { total: 0, payload };
  const first = new StateOwner(firstState), second = new StateOwner(secondState), alias: StateOwner = first;
  assert.sameValue(alias, first); assert.notSameValue(first, second);
  assert.sameValue(first.read(), firstState); assert.sameValue(second.read(), secondState);
  assert.sameValue(first.present(), true); assert.sameValue(second.present(), true);
  firstState.total = 3;
  assert.sameValue(alias.read(), firstState); assert.sameValue(firstState.total, 3); assert.sameValue(secondState.total, 0);
  assert.sameValue(firstState.payload, payload); assert.sameValue(secondState.payload, payload);
  assert.sameValue(alias.remove(), true); assert.sameValue(first.remove(), false);
  assert.sameValue(first.read(), undefined); assert.sameValue(alias.present(), false);
  assert.sameValue(second.read(), secondState); assert.sameValue(second.present(), true);
  assert.sameValue(second.remove(), true); assert.sameValue(second.remove(), false);
  assert.sameValue(second.read(), undefined); assert.sameValue(second.present(), false);
}
export {};
