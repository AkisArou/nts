/*---
description: A module class declaration preserves constructor, instance and payload identities through a nested typed reader.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-class, ts-construct-signatures, ts-closures]
flags: [module]
---*/
// Route: the module class declaration ScopeBox is read by a nested typed constructor caller; node keeps its constructor and new instance identities.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeState { target: typeof ScopeBox; log: unknown[]; calls: number; }
class ScopeBox { value: ScopeValue; constructor(state: ScopeState, value: ScopeValue) { this.value = value; state.calls++; state.log.push("class.construct", this, value, state.calls); } }
function makeConstructor(state: ScopeState): (state: ScopeState, value: ScopeValue) => [typeof ScopeBox, ScopeBox] {
  function nested(state: ScopeState): (state: ScopeState, value: ScopeValue) => [typeof ScopeBox, ScopeBox] { return (state, value) => {
    const target = ScopeBox; state.log.push("class.nested.binding", target);
    const result = new target(state, value); state.log.push("class.nested.result", result, result.value); return [target, result];
  }; }
  return nested(state);
}
const state: ScopeState = { target: ScopeBox, log: [], calls: 0 };
const identity = { id: 7 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const builder = makeConstructor(state);
for (const input of inputs) {
  state.log.length = 0; state.calls = 0;
  const first = builder(state, input), second = builder(state, input);
  for (const result of [first, second]) {
    assert.sameValue(Object.is(result[0], state.target), true); assert.sameValue(typeof result[0], "function");
    assert.sameValue(result[1] instanceof ScopeBox, true); assert.sameValue(typeof result[1], "object");
    assert.sameValue(Object.is(result[1].value, input), true); assert.sameValue(typeof result[1].value, typeof input);
  }
  assert.sameValue(Object.is(first[1], second[1]), false); assert.sameValue(state.calls, 2);
  assert.compareArray(state.log, ["class.nested.binding", state.target, "class.construct", first[1], input, 1, "class.nested.result", first[1], input, "class.nested.binding", state.target, "class.construct", second[1], input, 2, "class.nested.result", second[1], input]);
}
