/*---
description: Control for typed-optional-function-reassign; explicit state parameters preserve the same calls, identities and log.
features: [ts-scope-route-typed, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects, ts-optional-chaining]
flags: [module]
---*/
// Control: the writer and reader receive local state and use its operation field; targets receive the same state explicitly.
type ScopeValue = number | string | undefined | { id: number };
type ScopeOperation = (state: ScopeState, value: ScopeValue) => ScopeValue;
interface ScopeState { operation: ScopeOperation | undefined; log: unknown[]; writes: number; calls: number; }
function echoTarget(state: ScopeState, value: ScopeValue): ScopeValue { state.calls++; state.log.push("echo", value, state.calls); return value; }
function replace(state: ScopeState, next: ScopeOperation | undefined): void { state.operation = next; state.writes++; state.log.push("writer.write", next, state.writes); }
function invoke(state: ScopeState, input: ScopeValue): ScopeValue {
  const operation = state.operation; state.log.push("reader.read", operation, input);
  const result = operation?.(state, input); state.log.push("reader.result", result); return result;
}
const identity = { id: 17 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const state: ScopeState = { operation: undefined, log: [], writes: 0, calls: 0 };
for (const input of inputs) {
  state.log.length = 0; state.writes = 0; state.calls = 0;
  replace(state, undefined); const first = invoke(state, input);
  replace(state, echoTarget); const second = invoke(state, input);
  replace(state, undefined); const third = invoke(state, input);
  const final = state.operation; state.log.push("top.read", final);
  const checks: [unknown, unknown][] = [[first, undefined], [second, input], [third, undefined], [final, undefined]];
  for (const [actual, expected] of checks) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
  assert.sameValue(state.writes, 3); assert.sameValue(state.calls, 1);
  assert.compareArray(state.log, ["writer.write", undefined, 1, "reader.read", undefined, input, "reader.result", undefined, "writer.write", echoTarget, 2, "reader.read", echoTarget, input, "echo", input, 1, "reader.result", input, "writer.write", undefined, 3, "reader.read", undefined, input, "reader.result", undefined, "top.read", undefined]);
}
