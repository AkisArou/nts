/*---
description: Control for binding-class-plain; explicit state fields preserve the same reads, writes and observations.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-class, ts-construct-signatures]
flags: [module]
---*/
// Control: the constructor is passed in state.target; every constructor and caller receives that state explicitly.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeState { target: typeof ScopeBox; log: unknown[]; calls: number; }
class ScopeBox { value: ScopeValue; constructor(state: ScopeState, value: ScopeValue) { this.value = value; state.calls++; state.log.push("class.construct", this, value, state.calls); } }
function construct(state: ScopeState, value: ScopeValue): [typeof ScopeBox, ScopeBox] {
    const target = state.target; state.log.push("class.plain.binding", target);
    const result = new target(state, value); state.log.push("class.plain.result", result, result.value); return [target, result];
}
const state: ScopeState = { target: ScopeBox, log: [], calls: 0 };
const identity = { id: 7 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];

for (const input of inputs) {
  state.log.length = 0; state.calls = 0;
  const first = construct(state, input), second = construct(state, input);
  for (const result of [first, second]) {
    assert.sameValue(Object.is(result[0], state.target), true); assert.sameValue(typeof result[0], "function");
    assert.sameValue(result[1] instanceof ScopeBox, true); assert.sameValue(typeof result[1], "object");
    assert.sameValue(Object.is(result[1].value, input), true); assert.sameValue(typeof result[1].value, typeof input);
  }
  assert.sameValue(Object.is(first[1], second[1]), false); assert.sameValue(state.calls, 2);
  assert.compareArray(state.log, ["class.plain.binding", state.target, "class.construct", first[1], input, 1, "class.plain.result", first[1], input, "class.plain.binding", state.target, "class.construct", second[1], input, 2, "class.plain.result", second[1], input]);
}
