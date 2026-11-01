/*---
description: Control for typed-generic-class-exchange; explicit state parameters preserve the same values and log.
features: [ts-scope-route-typed, ts-modules, ts-generics, ts-class, ts-parameter-properties, ts-unions, ts-numbers, ts-strings, ts-objects]
flags: [module]
---*/
// Control: every callable receives the local state object; later reads use its fields.
type ScopeValue = number | string | undefined | { id: number };
const identity = { id: 17 };
const inputs: ScopeValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface ScopeState { value: ScopeValue; log: unknown[]; writes: number; }
class ScopePort<T extends ScopeValue> {
  constructor(readonly value: T) {}
  write(state: ScopeState): void { state.value = this.value; state.writes++; state.log.push("port.write", this, this.value, state.writes); }
  read(state: ScopeState): ScopeValue { const value = state.value; state.log.push("port.read", this, value); return value; }
}
const state: ScopeState = { value: 1, log: [], writes: 0 };
const numeric = new ScopePort<number>(-0), text = new ScopePort<string>("中");
for (const input of inputs) {
  const current = new ScopePort(input); state.log.length = 0; state.writes = 0;
  state.value = input; state.log.push("top.write", input);
  const before = numeric.read(state); assert.sameValue(Object.is(before, input), true); assert.sameValue(typeof before, typeof input);
  numeric.write(state); const afterNumber = text.read(state); assert.sameValue(Object.is(afterNumber, -0), true); assert.sameValue(typeof afterNumber, "number");
  text.write(state); const afterText = current.read(state); assert.sameValue(Object.is(afterText, "中"), true); assert.sameValue(typeof afterText, "string");
  current.write(state); const afterCurrent = numeric.read(state); assert.sameValue(Object.is(afterCurrent, input), true); assert.sameValue(typeof afterCurrent, typeof input);
  const final = state.value; state.log.push("top.read", final); assert.sameValue(Object.is(final, input), true); assert.sameValue(typeof final, typeof input);
  assert.sameValue(state.writes, 3);
  assert.compareArray(state.log, ["top.write", input, "port.read", numeric, input, "port.write", numeric, -0, 1, "port.read", text, -0, "port.write", text, "中", 2, "port.read", current, "中", "port.write", current, input, 3, "port.read", numeric, input, "top.read", input]);
}
