/*---
description: A module const array binding retains identity and mixed payloads through a nested typed reader.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays, ts-readonly, ts-closures]
flags: [module]
---*/
// Route: top-level const fixed is selected by a nested typed reader; node keeps its array identity and every indexed payload.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeState { items: readonly ScopeValue[]; log: unknown[]; reads: number; }
const identity = { id: 7 };
const fixed: readonly ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
function makeReader(state: ScopeState): (state: ScopeState, index: number) => [readonly ScopeValue[], ScopeValue] {
  function nested(state: ScopeState): (state: ScopeState, index: number) => [readonly ScopeValue[], ScopeValue] { return (state, index) => {
    const held = fixed; state.log.push("const.nested.binding", held);
    const value = held[index]; state.reads++; state.log.push("const.nested.item", index, value, state.reads); return [held, value];
  }; }
  return nested(state);
}
const state: ScopeState = { items: fixed, log: [], reads: 0 };
const reader = makeReader(state);
for (let index = 0; index < state.items.length; index++) {
  state.log.length = 0; state.reads = 0; const wanted = state.items[index];
  const first = reader(state, index), second = reader(state, index);
  for (const result of [first, second]) {
    assert.sameValue(Object.is(result[0], state.items), true); assert.sameValue(typeof result[0], "object");
    assert.sameValue(Object.is(result[1], wanted), true); assert.sameValue(typeof result[1], typeof wanted);
  }
  assert.sameValue(state.reads, 2); assert.sameValue(state.items.length, 9);
  assert.compareArray(state.log, ["const.nested.binding", state.items, "const.nested.item", index, wanted, 1, "const.nested.binding", state.items, "const.nested.item", index, wanted, 2]);
}
