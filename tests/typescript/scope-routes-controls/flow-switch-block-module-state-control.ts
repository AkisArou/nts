/*---
description: Control for flow-switch-block-module-state; explicit state fields preserve the same values, order and final state.
features: [ts-scope-route-control-flow, ts-modules, ts-functions, ts-function-types, ts-closures, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays]
flags: [module]
---*/
// Control: readers receive state and their slot explicitly; no function reads a module or top-level block binding.
type FlowValue = number | string | undefined | { id: number };
const identity = { id: 7 }; const inputs: FlowValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface FlowState { current: FlowValue; values: FlowValue[]; log: unknown[]; reads: number; }
const state: FlowState = { current: 1, values: [], log: ["module.init", 1], reads: 0 };
const readers: ((state: FlowState, slot: number) => [FlowValue, FlowValue])[] = [];
for (let at = 0; at < inputs.length; at++) {
  let read: (state: FlowState, slot: number) => [FlowValue, FlowValue];
  switch (at % 3) {
    case 0: {
      state.values[at] = 1; state.log.push("switch.zero.init", state.values[at]);
      read = (state, slot) => { const seen: [FlowValue, FlowValue] = [state.values[slot], state.current]; state.reads++; state.log.push("switch.zero.read", seen[0], seen[1], state.reads); return seen; };
      state.values[at] = inputs[at]; state.log.push("switch.zero.write", state.values[at]); break;
    }
    case 1: {
      state.values[at] = "seed"; state.log.push("switch.one.init", state.values[at]);
      read = (state, slot) => { const seen: [FlowValue, FlowValue] = [state.values[slot], state.current]; state.reads++; state.log.push("switch.one.read", seen[0], seen[1], state.reads); return seen; };
      state.values[at] = inputs[at]; state.log.push("switch.one.write", state.values[at]); break;
    }
    default: {
      state.values[at] = undefined; state.log.push("switch.default.init", state.values[at]);
      read = (state, slot) => { const seen: [FlowValue, FlowValue] = [state.values[slot], state.current]; state.reads++; state.log.push("switch.default.read", seen[0], seen[1], state.reads); return seen; };
      state.values[at] = inputs[at]; state.log.push("switch.default.write", state.values[at]); break;
    }
  }
  state.current = inputs[at]; state.log.push("module.write", state.current); readers.push(read); const seen = read(state, at);
  for (const observed of seen) { assert.sameValue(Object.is(observed, inputs[at]), true); assert.sameValue(typeof observed, typeof inputs[at]); }
}
state.current = undefined; state.log.push("top.write", undefined);
for (let slot = 0; slot < readers.length; slot++) {
  const seen = readers[slot](state, slot);
  assert.sameValue(Object.is(seen[0], inputs[slot]), true); assert.sameValue(typeof seen[0], typeof inputs[slot]);
  assert.sameValue(Object.is(seen[1], undefined), true); assert.sameValue(typeof seen[1], "undefined");
}
const final = state.current; state.log.push("top.read", final); assert.sameValue(Object.is(final, undefined), true); assert.sameValue(typeof final, "undefined");
assert.sameValue(state.reads, inputs.length * 2);
const labels: string[] = ["zero", "one", "default"]; const initial: FlowValue[] = [1, "seed", undefined]; const expected: unknown[] = ["module.init", 1];
for (let slot = 0; slot < inputs.length; slot++) { const branch = slot % 3; expected.push("switch." + labels[branch] + ".init", initial[branch], "switch." + labels[branch] + ".write", inputs[slot], "module.write", inputs[slot], "switch." + labels[branch] + ".read", inputs[slot], inputs[slot], slot + 1); }
expected.push("top.write", undefined);
for (let slot = 0; slot < inputs.length; slot++) expected.push("switch." + labels[slot % 3] + ".read", inputs[slot], undefined, inputs.length + slot + 1);
expected.push("top.read", undefined); assert.compareArray(state.log, expected);
