/*---
description: Control for typed-generic-function-exchange; explicit state parameters preserve the same values and log.
features: [ts-scope-route-typed, ts-modules, ts-generics, ts-functions, ts-unions, ts-numbers, ts-strings, ts-objects]
flags: [module]
---*/
// Control: every callable receives the local state object; later reads use its fields.
type ScopeValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface ScopeState { value: ScopeValue; log: unknown[]; writes: number; }
function exchange<T extends ScopeValue>(state: ScopeState, next: T): ScopeValue {
  const previous = state.value; state.log.push("generic.read", previous);
  state.value = next; state.writes++; state.log.push("generic.write", next, state.writes); return previous;
}
const state: ScopeState = { value: 1, log: [], writes: 0 };
for (const input of inputs) {
  state.log.length = 0; state.writes = 0; state.value = input; state.log.push("top.write", input);
  const first = exchange<number>(state, -0);
  assert.sameValue(Object.is(first, input), true); assert.sameValue(typeof first, typeof input);
  const second = exchange<string>(state, "中");
  assert.sameValue(Object.is(second, -0), true); assert.sameValue(typeof second, "number");
  const third = exchange<undefined>(state, undefined);
  assert.sameValue(Object.is(third, "中"), true); assert.sameValue(typeof third, "string");
  const fourth = exchange<{ id: number }>(state, identity);
  assert.sameValue(Object.is(fourth, undefined), true); assert.sameValue(typeof fourth, "undefined");
  const fifth = exchange(state, input);
  assert.sameValue(Object.is(fifth, identity), true); assert.sameValue(typeof fifth, "object");
  const final = state.value; state.log.push("top.read", final);
  assert.sameValue(Object.is(final, input), true); assert.sameValue(typeof final, typeof input); assert.sameValue(state.writes, 5);
  assert.compareArray(state.log, ["top.write", input, "generic.read", input, "generic.write", -0, 1, "generic.read", -0, "generic.write", "中", 2, "generic.read", "中", "generic.write", undefined, 3, "generic.read", undefined, "generic.write", identity, 4, "generic.read", identity, "generic.write", input, 5, "top.read", input]);
}
