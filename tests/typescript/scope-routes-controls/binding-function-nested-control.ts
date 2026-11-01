/*---
description: Control for binding-function-nested; explicit state fields preserve the same reads, writes and observations.
features: [ts-scope-route-bindings, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-closures]
flags: [module]
---*/
// Control: the selected function is an explicit state field; its body and both calls are unchanged.
type ScopeValue = number | string | undefined | { id: number };
type ScopeFunction = (state: ScopeState, value: ScopeValue) => ScopeValue;
interface ScopeState { target: ScopeFunction; log: unknown[]; calls: number; }
function scopeEcho(state: ScopeState, value: ScopeValue): ScopeValue { state.calls++; state.log.push("function.enter", value, state.calls); return value; }
function makeCaller(state: ScopeState): (state: ScopeState, value: ScopeValue) => [ScopeFunction, ScopeValue] {
  function nested(state: ScopeState): (state: ScopeState, value: ScopeValue) => [ScopeFunction, ScopeValue] { return (state, value) => {
    const target = state.target; state.log.push("function.nested.binding", target);
    const result = target(state, value); state.log.push("function.nested.result", result); return [target, result];
  }; }
  return nested(state);
}
const state: ScopeState = { target: scopeEcho, log: [], calls: 0 };
const identity = { id: 7 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const caller = makeCaller(state);
for (const input of inputs) {
  state.log.length = 0; state.calls = 0;
  const first = caller(state, input), second = caller(state, input);
  for (const result of [first, second]) {
    assert.sameValue(Object.is(result[0], state.target), true); assert.sameValue(typeof result[0], "function");
    assert.sameValue(Object.is(result[1], input), true); assert.sameValue(typeof result[1], typeof input);
  }
  assert.sameValue(state.calls, 2);
  assert.compareArray(state.log, ["function.nested.binding", state.target, "function.enter", input, 1, "function.nested.result", input, "function.nested.binding", state.target, "function.enter", input, 2, "function.nested.result", input]);
}
