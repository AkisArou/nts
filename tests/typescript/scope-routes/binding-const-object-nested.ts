/*---
description: A module const object keeps its identity while a nested typed function and the top level mutate mixed field values.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-closures]
flags: [module]
---*/
// Route: const shared keeps one object while a nested typed writer and the top level change its fields; node retains every later value.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeObject { value: ScopeValue; writes: number; }
interface ScopeState { target: ScopeObject; log: unknown[]; }
const shared: ScopeObject = { value: 1, writes: 0 };
function makeWriter(state: ScopeState): (state: ScopeState, value: ScopeValue) => [ScopeObject, ScopeValue] {
  function nested(state: ScopeState): (state: ScopeState, value: ScopeValue) => [ScopeObject, ScopeValue] { return (state, value) => {
    const target = shared; state.log.push("object.nested.binding", target);
    const before = target.value; state.log.push("object.nested.read", before);
    target.value = value; target.writes++; state.log.push("object.nested.write", value, target.writes);
    const after = target.value; state.log.push("object.nested.read", after); return [target, after];
  }; }
  return nested(state);
}
const state: ScopeState = { target: shared, log: [] };
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
