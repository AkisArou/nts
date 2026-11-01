/*---
description: A module union of two function signatures changes targets repeatedly and receives all three arguments at the shared call site.
features: [ts-scope-route-typed, ts-modules, ts-functions, ts-function-types, ts-unions, ts-numbers, ts-strings, ts-objects]
flags: [module]
---*/
// Route: module let active alternates two- and three-parameter functions; node returns the first payload or extra payload for the current target.
type ScopeValue = number | string | undefined | { id: number };
type ScopeOperation = ((state: ScopeState, value: ScopeValue) => ScopeValue) | ((state: ScopeState, value: ScopeValue, extra: ScopeValue) => ScopeValue);
interface ScopeState { operation: ScopeOperation; log: unknown[]; writes: number; calls: number; }
function firstTarget(state: ScopeState, value: ScopeValue): ScopeValue { state.calls++; state.log.push("first", value, state.calls); return value; }
function extraTarget(state: ScopeState, value: ScopeValue, extra: ScopeValue): ScopeValue { state.calls++; state.log.push("extra", value, extra, state.calls); return extra; }
let active: ScopeOperation = firstTarget;
function replace(state: ScopeState, next: ScopeOperation): void { active = next; state.writes++; state.log.push("writer.write", next, state.writes); }
function invoke(state: ScopeState, input: ScopeValue, extra: ScopeValue): ScopeValue {
  const operation = active; state.log.push("reader.read", operation, input, extra);
  const result = operation(state, input, extra); state.log.push("reader.result", result); return result;
}
const identity = { id: 17 }; const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
const state: ScopeState = { operation: firstTarget, log: [], writes: 0, calls: 0 };
for (const input of inputs) {
  state.log.length = 0; state.writes = 0; state.calls = 0;
  replace(state, firstTarget); const first = invoke(state, input, "tail");
  replace(state, extraTarget); const second = invoke(state, "head", input);
  replace(state, firstTarget); const third = invoke(state, undefined, input);
  const final = active; state.log.push("top.read", final);
  const checks: [unknown, unknown][] = [[first, input], [second, input], [third, undefined], [final, firstTarget]];
  for (const [actual, expected] of checks) { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
  assert.sameValue(state.writes, 3); assert.sameValue(state.calls, 3);
  assert.compareArray(state.log, ["writer.write", firstTarget, 1, "reader.read", firstTarget, input, "tail", "first", input, 1, "reader.result", input, "writer.write", extraTarget, 2, "reader.read", extraTarget, "head", input, "extra", "head", input, 2, "reader.result", input, "writer.write", firstTarget, 3, "reader.read", firstTarget, undefined, input, "first", undefined, 3, "reader.result", undefined, "top.read", firstTarget]);
}
