/*---
description: A function writer replaces a module function binding and a separate reader calls each current target with explicit state.
features: [ts-scope-route-typed, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects]
flags: [module]
---*/
// Route: a writer changes module let active between echo and fallback targets; node calls the latest function and preserves mixed-value identity.
type ScopeValue = number | string | undefined | { id: number };
type ScopeOperation = (state: ScopeState, value: ScopeValue) => ScopeValue;
interface ScopeState { operation: ScopeOperation; fallback: ScopeValue; log: unknown[]; writes: number; calls: number; }
function echoTarget(state: ScopeState, value: ScopeValue): ScopeValue { state.calls++; state.log.push("echo", value, state.calls); return value; }
function fallbackTarget(state: ScopeState, value: ScopeValue): ScopeValue { const result = state.fallback; state.calls++; state.log.push("fallback", value, result, state.calls); return result; }
let active: ScopeOperation = echoTarget;
function replace(state: ScopeState, next: ScopeOperation): void { active = next; state.writes++; state.log.push("writer.write", next, state.writes); }
function invoke(state: ScopeState, input: ScopeValue): ScopeValue {
  const operation = active; state.log.push("reader.read", operation, input);
  const result = operation(state, input); state.log.push("reader.result", result); return result;
}
const identity = { id: 17 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const state: ScopeState = { operation: echoTarget, fallback: undefined, log: [], writes: 0, calls: 0 };
for (const input of inputs) {
  state.log.length = 0; state.writes = 0; state.calls = 0; state.fallback = input; state.log.push("state.fallback", input);
  replace(state, echoTarget); const first = invoke(state, input);
  replace(state, fallbackTarget); const second = invoke(state, "decoy");
  replace(state, echoTarget); const third = invoke(state, undefined);
  const final = active; state.log.push("top.read", final);
  const checks: [unknown, unknown][] = [[first, input], [second, input], [third, undefined], [final, echoTarget], [state.fallback, input]];
  for (const [actual, expected] of checks) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
  assert.sameValue(state.writes, 3); assert.sameValue(state.calls, 3);
  assert.compareArray(state.log, ["state.fallback", input, "writer.write", echoTarget, 1, "reader.read", echoTarget, input, "echo", input, 1, "reader.result", input, "writer.write", fallbackTarget, 2, "reader.read", fallbackTarget, "decoy", "fallback", "decoy", input, 2, "reader.result", input, "writer.write", echoTarget, 3, "reader.read", echoTarget, undefined, "echo", undefined, 3, "reader.result", undefined, "top.read", echoTarget]);
}
