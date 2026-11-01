/*---
description: A module const object keeps its identity while a plain typed function and the top level mutate mixed field values.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects]
flags: [module]
---*/
// Route: const shared keeps one object while a plain typed writer and the top level change its fields; node retains every later value.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeObject { value: ScopeValue; writes: number; }
interface ScopeState { target: ScopeObject; log: unknown[]; }
const shared: ScopeObject = { value: 1, writes: 0 };
function update(state: ScopeState, value: ScopeValue): [ScopeObject, ScopeValue] {
    const target = shared; state.log.push("object.plain.binding", target);
    const before = target.value; state.log.push("object.plain.read", before);
    target.value = value; target.writes++; state.log.push("object.plain.write", value, target.writes);
    const after = target.value; state.log.push("object.plain.read", after); return [target, after];
}
const state: ScopeState = { target: shared, log: [] };
const identity = { id: 7 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];

for (const input of inputs) {
  state.log.length = 0; state.target.value = 1; state.target.writes = 0; state.log.push("top.write", 1, 0);
  const first = update(state, input);
  state.target.value = undefined; state.target.writes++; state.log.push("top.write", undefined, state.target.writes);
  const second = update(state, input);
  for (const result of [first, second]) {
    assert.sameValue(Object.is(result[0], state.target), true); assert.sameValue(typeof result[0], "object");
    assert.sameValue(Object.is(result[1], input), true); assert.sameValue(typeof result[1], typeof input);
  }
  const final = state.target.value; state.log.push("top.read", final); assert.sameValue(Object.is(final, input), true); assert.sameValue(typeof final, typeof input); assert.sameValue(state.target.writes, 3);
  assert.compareArray(state.log, ["top.write", 1, 0, "object.plain.binding", state.target, "object.plain.read", 1, "object.plain.write", input, 1, "object.plain.read", input, "top.write", undefined, 2, "object.plain.binding", state.target, "object.plain.read", undefined, "object.plain.write", input, 3, "object.plain.read", input, "top.read", input]);
}
