/*---
description: Control for flow-for-let-module-state; explicit state fields preserve the same values, order and final state.
features: [ts-scope-route-control-flow, ts-modules, ts-functions, ts-function-types, ts-closures, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays, ts-iteration]
flags: [module]
---*/
// Control: readers receive state and their slot explicitly; no function reads a module or top-level block binding.
type FlowValue = number | string | undefined | { id: number };
const identity = { id: 7 }; const inputs: FlowValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface FlowState { current: FlowValue; index: number; indexes: number[]; log: unknown[]; reads: number; }
const state: FlowState = { current: 1, index: 0, indexes: [], log: ["module.init", 1, "for.init", 0], reads: 0 };
const readers: ((state: FlowState, slot: number) => [number, FlowValue])[] = [];
for (let turn: number = 0; turn < inputs.length; turn++, state.log.push("for.update", turn)) {
  state.current = inputs[turn]; state.log.push("for.write", turn, state.current); state.indexes.push(turn);
  const read: (state: FlowState, slot: number) => [number, FlowValue] = (state, slot) => {
    const seen: [number, FlowValue] = [state.indexes[slot], state.current]; state.reads++; state.log.push("for.read", seen[0], seen[1], state.reads); return seen;
  };
  readers.push(read); const seen = read(state, turn);
  assert.sameValue(Object.is(seen[0], turn), true); assert.sameValue(typeof seen[0], "number");
  assert.sameValue(Object.is(seen[1], inputs[turn]), true); assert.sameValue(typeof seen[1], typeof inputs[turn]);
}
state.current = undefined; state.log.push("top.write", undefined);
for (let slot = 0; slot < readers.length; slot++) {
  const seen = readers[slot](state, slot);
  assert.sameValue(Object.is(seen[0], slot), true); assert.sameValue(typeof seen[0], "number");
  assert.sameValue(Object.is(seen[1], undefined), true); assert.sameValue(typeof seen[1], "undefined");
}
const final = state.current; state.log.push("top.read", final); assert.sameValue(Object.is(final, undefined), true); assert.sameValue(typeof final, "undefined");
assert.sameValue(state.reads, inputs.length * 2); assert.sameValue(state.indexes.length, inputs.length);

const expected: unknown[] = ["module.init", 1, "for.init", 0];
for (let slot = 0; slot < inputs.length; slot++) expected.push("for.write", slot, inputs[slot], "for.read", slot, inputs[slot], slot + 1, "for.update", slot + 1);
expected.push("top.write", undefined);
for (let slot = 0; slot < inputs.length; slot++) expected.push("for.read", slot, undefined, inputs.length + slot + 1);
expected.push("top.read", undefined); assert.compareArray(state.log, expected);
