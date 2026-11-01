/*---
description: Control for typed-union-narrowed-value; explicit state parameters preserve the same values and log.
features: [ts-scope-route-typed, ts-modules, ts-unions, ts-narrowing, ts-functions, ts-numbers, ts-strings, ts-objects]
flags: [module]
---*/
// Control: every callable receives the local state object; later reads use its fields.
type ScopeValue = number | string | undefined | { id: number };
interface ScopeState { value: ScopeValue; log: unknown[]; reads: number; }
function readNarrowed(state: ScopeState): ScopeValue {
  const value = state.value; state.reads++; state.log.push("union.read", value, state.reads);
  const result = typeof value === "number" ? value + 0.5 : typeof value === "string" ? value + "!" : value;
  state.log.push("union.result", typeof value, result); return result;
}
const identity = { id: 17 };
const inputs: [ScopeValue, ScopeValue][] = [[0, 0.5], [-0, 0.5], [NaN, NaN], [0.5, 1], [2147483648, 2147483648.5], ["", "!"], ["中", "中!"], [undefined, undefined], [identity, identity]];
const state: ScopeState = { value: 1, log: [], reads: 0 };
for (const [input, expected] of inputs) {
  state.log.length = 0; state.reads = 0; state.value = input; state.log.push("top.write", input);
  const first = readNarrowed(state); assert.sameValue(Object.is(first, expected), true); assert.sameValue(typeof first, typeof expected);
  state.value = "later"; state.log.push("top.write", "later");
  const second = readNarrowed(state); assert.sameValue(Object.is(second, "later!"), true); assert.sameValue(typeof second, "string");
  state.value = input; state.log.push("top.write", input);
  const third = readNarrowed(state); assert.sameValue(Object.is(third, expected), true); assert.sameValue(typeof third, typeof expected);
  const final = state.value; state.log.push("top.read", final); assert.sameValue(Object.is(final, input), true); assert.sameValue(typeof final, typeof input);
  assert.sameValue(state.reads, 3);
  assert.compareArray(state.log, ["top.write", input, "union.read", input, 1, "union.result", typeof input, expected, "top.write", "later", "union.read", "later", 2, "union.result", "string", "later!", "top.write", input, "union.read", input, 3, "union.result", typeof input, expected, "top.read", input]);
}
