/*---
description: Generic typed readers keep their local keys while observing later module binding writes.
features: [ts-scope-route-typed, ts-modules, ts-generics, ts-functions, ts-function-types, ts-closures, ts-unions, ts-numbers, ts-strings, ts-objects]
flags: [module]
---*/
// Route: select<T> returns a typed reader of module let shared; node keeps each generic key and sees writes after closure creation.
type ScopeValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface ScopeState { value: ScopeValue; log: unknown[]; reads: number; }
let shared: ScopeValue = 1;
function select<T>(state: ScopeState, key: T): (state: ScopeState) => [T, ScopeValue] {
  state.log.push("select", key);
  return (state) => { const value = shared; state.reads++; state.log.push("selected.read", key, value, state.reads); return [key, value]; };
}
const state: ScopeState = { value: 1, log: [], reads: 0 };
for (const input of inputs) {
  state.log.length = 0; state.reads = 0; shared = 1; state.log.push("top.write", 1);
  const numberReader = select<number>(state, -0), stringReader = select<string>(state, "中"), objectReader = select<{ id: number }>(state, identity);
  shared = input; state.log.push("top.write", input);
  const first = numberReader(state), second = stringReader(state), third = objectReader(state);
  assert.sameValue(Object.is(first[0], -0), true); assert.sameValue(typeof first[0], "number");
  assert.sameValue(Object.is(second[0], "中"), true); assert.sameValue(typeof second[0], "string");
  assert.sameValue(Object.is(third[0], identity), true); assert.sameValue(typeof third[0], "object");
  for (const result of [first[1], second[1], third[1]]) { assert.sameValue(Object.is(result, input), true); assert.sameValue(typeof result, typeof input); }
  shared = undefined; state.log.push("top.write", undefined); const later = objectReader(state);
  assert.sameValue(Object.is(later[0], identity), true); assert.sameValue(typeof later[0], "object");
  assert.sameValue(Object.is(later[1], undefined), true); assert.sameValue(typeof later[1], "undefined");
  const final = shared; state.log.push("top.read", final); assert.sameValue(Object.is(final, undefined), true); assert.sameValue(typeof final, "undefined");
  assert.sameValue(state.reads, 4);
  assert.compareArray(state.log, ["top.write", 1, "select", -0, "select", "中", "select", identity, "top.write", input, "selected.read", -0, input, 1, "selected.read", "中", input, 2, "selected.read", identity, input, 3, "top.write", undefined, "selected.read", identity, undefined, 4, "top.read", undefined]);
}
