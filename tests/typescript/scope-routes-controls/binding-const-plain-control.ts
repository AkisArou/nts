/*---
description: Control for binding-const-plain; explicit state fields preserve the same reads, writes and observations.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays, ts-readonly]
flags: [module]
---*/
// Control: the reader receives the array through state.items with the same identity and indexed observations.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeState { items: readonly ScopeValue[]; log: unknown[]; reads: number; }
const identity = { id: 7 };
function read(state: ScopeState, index: number): [readonly ScopeValue[], ScopeValue] {
    const held = state.items; state.log.push("const.plain.binding", held);
    const value = held[index]; state.reads++; state.log.push("const.plain.item", index, value, state.reads); return [held, value];
}
const state: ScopeState = { items: [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity], log: [], reads: 0 };

for (let index = 0; index < state.items.length; index++) {
  state.log.length = 0; state.reads = 0; const wanted = state.items[index];
  const first = read(state, index), second = read(state, index);
  for (const result of [first, second]) {
    assert.sameValue(Object.is(result[0], state.items), true); assert.sameValue(typeof result[0], "object");
    assert.sameValue(Object.is(result[1], wanted), true); assert.sameValue(typeof result[1], typeof wanted);
  }
  assert.sameValue(state.reads, 2); assert.sameValue(state.items.length, 9);
  assert.compareArray(state.log, ["const.plain.binding", state.items, "const.plain.item", index, wanted, 1, "const.plain.binding", state.items, "const.plain.item", index, wanted, 2]);
}
