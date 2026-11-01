/*---
description: A top-level while loop retains each body binding while typed readers see the final shared module counter and later module payload.
features: [ts-scope-route-control-flow, ts-modules, ts-functions, ts-function-types, ts-closures, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays, ts-iteration]
flags: [module]
---*/
// Route: while-body readers capture a typed body value and two module bindings; node retains the value but reads the final counter and later payload.
type FlowValue = number | string | undefined | { id: number };
const identity = { id: 7 }; const inputs: FlowValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface FlowState { current: FlowValue; index: number; values: FlowValue[]; log: unknown[]; reads: number; }
let current: FlowValue = 1; let turn: number = 0;
const state: FlowState = { current: 1, index: 0, values: [], log: ["module.init", 1, "while.init", 0], reads: 0 };
const readers: ((state: FlowState, slot: number) => [number, FlowValue, FlowValue])[] = [];
while (turn < inputs.length) {
  const value: FlowValue = inputs[turn]; state.log.push("while.bind", turn, value); current = value; state.log.push("module.write", current); state.values.push(value);
  const read: (state: FlowState, slot: number) => [number, FlowValue, FlowValue] = (state, slot) => {
    const seen: [number, FlowValue, FlowValue] = [turn, value, current]; state.reads++; state.log.push("while.read", seen[0], seen[1], seen[2], state.reads); return seen;
  };
  readers.push(read); const seen = read(state, turn);
  assert.sameValue(Object.is(seen[0], turn), true); assert.sameValue(typeof seen[0], "number");
  for (const observed of [seen[1], seen[2]]) { assert.sameValue(Object.is(observed, value), true); assert.sameValue(typeof observed, typeof value); }
  turn++; state.log.push("while.update", turn);
}
current = undefined; state.log.push("top.write", undefined);
for (let slot = 0; slot < readers.length; slot++) {
  const seen = readers[slot](state, slot);
  assert.sameValue(Object.is(seen[0], inputs.length), true); assert.sameValue(typeof seen[0], "number");
  assert.sameValue(Object.is(seen[1], inputs[slot]), true); assert.sameValue(typeof seen[1], typeof inputs[slot]);
  assert.sameValue(Object.is(seen[2], undefined), true); assert.sameValue(typeof seen[2], "undefined");
}
const final = current; state.log.push("top.read", final); assert.sameValue(Object.is(final, undefined), true); assert.sameValue(typeof final, "undefined");
assert.sameValue(Object.is(turn, inputs.length), true); assert.sameValue(typeof turn, "number"); assert.sameValue(state.reads, inputs.length * 2);
const expected: unknown[] = ["module.init", 1, "while.init", 0];
for (let slot = 0; slot < inputs.length; slot++) expected.push("while.bind", slot, inputs[slot], "module.write", inputs[slot], "while.read", slot, inputs[slot], inputs[slot], slot + 1, "while.update", slot + 1);
expected.push("top.write", undefined);
for (let slot = 0; slot < inputs.length; slot++) expected.push("while.read", inputs.length, inputs[slot], undefined, inputs.length + slot + 1);
expected.push("top.read", undefined); assert.compareArray(state.log, expected);
