/*---
description: Control for flow-forof-module-state; explicit state fields preserve the same values, order and final state.
features: [ts-scope-route-control-flow, ts-modules, ts-functions, ts-function-types, ts-closures, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays, ts-iteration]
flags: [module]
---*/
// Control: readers receive state and their slot explicitly; no function reads a module or top-level block binding.
type FlowValue = number | string | undefined | { id: number };
const identity = { id: 7 }; const inputs: FlowValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface FlowState { current: FlowValue; values: FlowValue[]; log: unknown[]; reads: number; }
const state: FlowState = { current: 1, values: [], log: ["module.init", 1], reads: 0 };
const readers: ((state: FlowState, slot: number) => [FlowValue, FlowValue])[] = [];
for (const value of inputs) {
  state.log.push("forof.bind", value); state.current = value; state.log.push("module.write", state.current); state.values.push(value);
  const read: (state: FlowState, slot: number) => [FlowValue, FlowValue] = (state, slot) => {
    const seen: [FlowValue, FlowValue] = [state.values[slot], state.current]; state.reads++; state.log.push("forof.read", seen[0], seen[1], state.reads); return seen;
  };
  readers.push(read); const seen = read(state, readers.length - 1);
  for (const observed of seen) { assert.sameValue(Object.is(observed, value), true); assert.sameValue(typeof observed, typeof value); }
}
state.current = undefined; state.log.push("top.write", undefined);
for (let slot = 0; slot < readers.length; slot++) {
  const seen = readers[slot](state, slot);
  assert.sameValue(Object.is(seen[0], inputs[slot]), true); assert.sameValue(typeof seen[0], typeof inputs[slot]);
  assert.sameValue(Object.is(seen[1], undefined), true); assert.sameValue(typeof seen[1], "undefined");
}
const final = state.current; state.log.push("top.read", final); assert.sameValue(Object.is(final, undefined), true); assert.sameValue(typeof final, "undefined");
assert.sameValue(state.reads, inputs.length * 2); assert.sameValue(state.values.length, inputs.length);
const expected: unknown[] = ["module.init", 1];
for (let slot = 0; slot < inputs.length; slot++) expected.push("forof.bind", inputs[slot], "module.write", inputs[slot], "forof.read", inputs[slot], inputs[slot], slot + 1);
expected.push("top.write", undefined);
for (let slot = 0; slot < inputs.length; slot++) expected.push("forof.read", inputs[slot], undefined, inputs.length + slot + 1);
expected.push("top.read", undefined); assert.compareArray(state.log, expected);
