/*---
description: Control for flow-array-destructuring-default; explicit state fields preserve the same values, order and final state.
features: [ts-scope-route-control-flow, ts-modules, ts-functions, ts-function-types, ts-closures, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays, ts-destructuring, ts-tuples]
flags: [module]
---*/
// Control: readers receive state and their slot explicitly; no function reads a module or top-level block binding.
type FlowValue = number | string | undefined | { id: number };
const identity = { id: 7 }; const inputs: FlowValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface FlowState { value: FlowValue; log: unknown[]; reads: number; }
function read(state: FlowState, phase: string): FlowValue {
  const observed = state.value; state.reads++; state.log.push("array.read", phase, observed, state.reads); return observed;
}
const state: FlowState = { value: undefined, log: [], reads: 0 };
[state.value = 1] = [];
state.log.push("declaration.write", state.value);
const initial = read(state, "initial"); assert.sameValue(Object.is(initial, 1), true); assert.sameValue(typeof initial, "number");
const expected: unknown[] = ["declaration.write", 1, "array.read", "initial", 1, 1];
let at = 0;
for (const input of inputs) {
  [state.value = 1] = [input]; state.log.push("array.write", state.value);
  const wanted = input === undefined ? 1 : input;
  const assigned = read(state, "assigned"); assert.sameValue(Object.is(assigned, wanted), true); assert.sameValue(typeof assigned, typeof wanted);
  state.value = "outside"; state.log.push("top.write", "outside");
  const outside = read(state, "outside"); assert.sameValue(Object.is(outside, "outside"), true); assert.sameValue(typeof outside, "string");
  [state.value = 1] = [input]; state.log.push("array.restore", state.value);
  const restored = read(state, "restored"); assert.sameValue(Object.is(restored, wanted), true); assert.sameValue(typeof restored, typeof wanted);
  expected.push("array.write", wanted, "array.read", "assigned", wanted, at * 3 + 2, "top.write", "outside", "array.read", "outside", "outside", at * 3 + 3, "array.restore", wanted, "array.read", "restored", wanted, at * 3 + 4); at++;
}
const final = state.value; state.log.push("top.read", final); assert.sameValue(Object.is(final, identity), true); assert.sameValue(typeof final, "object");
assert.sameValue(state.reads, inputs.length * 3 + 1); expected.push("top.read", identity); assert.compareArray(state.log, expected);
