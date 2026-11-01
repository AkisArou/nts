/*---
description: Control for binding-const-object-nested; explicit state fields preserve the same reads, writes and observations.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-closures]
flags: [module]
---*/
// Control: the mutable object lives in the passed state; the same reads, writes and identities remain observable.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeObject { value: ScopeValue; writes: number; }
interface ScopeState { target: ScopeObject; log: unknown[]; }
function makeWriter(state: ScopeState): (state: ScopeState, value: ScopeValue) => [ScopeObject, ScopeValue] {
  function nested(state: ScopeState): (state: ScopeState, value: ScopeValue) => [ScopeObject, ScopeValue] { return (state, value) => {
    const target = state.target; state.log.push("object.nested.binding", target);
    const before = target.value; state.log.push("object.nested.read", before);
    target.value = value; target.writes++; state.log.push("object.nested.write", value, target.writes);
    const after = target.value; state.log.push("object.nested.read", after); return [target, after];
  }; }
  return nested(state);
}
const state: ScopeState = { target: { value: 1, writes: 0 }, log: [] };
const identity = { id: 7 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const writer = makeWriter(state);
for (const input of inputs) {
  state.log.length = 0; state.target.value = 1; state.target.writes = 0; state.log.push("top.write", 1, 0);
  const first = writer(state, input);
  state.target.value = undefined; state.target.writes++; state.log.push("top.write", undefined, state.target.writes);
  const second = writer(state, input);
  for (const result of [first, second]) {
    assert.sameValue(Object.is(result[0], state.target), true); assert.sameValue(typeof result[0], "object");
    assert.sameValue(Object.is(result[1], input), true); assert.sameValue(typeof result[1], typeof input);
  }
  const final = state.target.value; state.log.push("top.read", final); assert.sameValue(Object.is(final, input), true); assert.sameValue(typeof final, typeof input); assert.sameValue(state.target.writes, 3);
  assert.compareArray(state.log, ["top.write", 1, 0, "object.nested.binding", state.target, "object.nested.read", 1, "object.nested.write", input, 1, "object.nested.read", input, "top.write", undefined, 2, "object.nested.binding", state.target, "object.nested.read", undefined, "object.nested.write", input, 3, "object.nested.read", input, "top.read", input]);
}
