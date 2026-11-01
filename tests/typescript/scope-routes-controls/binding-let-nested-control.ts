/*---
description: Control for binding-let-nested; explicit state fields preserve the same reads, writes and observations.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-closures]
flags: [module]
---*/
// Control: each typed reader and writer receives the local state object; no function reads a module binding.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeState { value: ScopeValue; log: unknown[]; reads: number; writes: number; }
interface ScopeRoutes { read: (state: ScopeState) => ScopeValue; write: (state: ScopeState, value: ScopeValue) => void; }
function makeRoutes(state: ScopeState): ScopeRoutes {
  function nested(state: ScopeState): ScopeRoutes { return {
    read: (state) => { const value = state.value; state.reads++; state.log.push("let.nested.read", value, state.reads); return value; },
    write: (state, value) => { state.value = value; state.writes++; state.log.push("let.nested.write", value, state.writes); }
  }; }
  return nested(state);
}
const state: ScopeState = { value: 1, log: [], reads: 0, writes: 0 };
const identity = { id: 7 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const routes: ScopeRoutes = makeRoutes(state);
for (const input of inputs) {
  state.log.length = 0; state.reads = 0; state.writes = 0; state.value = 1; state.log.push("top.write", 1);
  const before = routes.read(state); assert.sameValue(Object.is(before, 1), true); assert.sameValue(typeof before, "number");
  routes.write(state, input); const after = routes.read(state); assert.sameValue(Object.is(after, input), true); assert.sameValue(typeof after, typeof input);
  state.value = undefined; state.log.push("top.write", undefined);
  const cleared = routes.read(state); assert.sameValue(Object.is(cleared, undefined), true); assert.sameValue(typeof cleared, "undefined");
  routes.write(state, input); const restored = routes.read(state); assert.sameValue(Object.is(restored, input), true); assert.sameValue(typeof restored, typeof input);
  const final = state.value; state.log.push("top.read", final); assert.sameValue(Object.is(final, input), true); assert.sameValue(typeof final, typeof input);
  assert.sameValue(state.reads, 4); assert.sameValue(state.writes, 2);
  assert.compareArray(state.log, ["top.write", 1, "let.nested.read", 1, 1, "let.nested.write", input, 1, "let.nested.read", input, 2, "top.write", undefined, "let.nested.read", undefined, 3, "let.nested.write", input, 2, "let.nested.read", input, 4, "top.read", input]);
}
