/*---
description: A module object-destructured binding keeps its default and every later typed read after defaulted assignments and outside writes.
features: [ts-scope-route-control-flow, ts-modules, ts-functions, ts-function-types, ts-closures, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays, ts-destructuring]
flags: [module]
---*/
// Route: object destructuring declares module current and defaults missing or undefined values to 1; typed readers see each later reassignment.
type FlowValue = number | string | undefined | { id: number };
const identity = { id: 7 }; const inputs: FlowValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface FlowState { value: FlowValue; log: unknown[]; reads: number; }
let { value: current = 1 }: { value?: FlowValue } = {};
function read(state: FlowState, phase: string): FlowValue {
  const observed = current; state.reads++; state.log.push("object.read", phase, observed, state.reads); return observed;
}
const state: FlowState = { value: undefined, log: [], reads: 0 };
state.log.push("declaration.write", current);
const initial = read(state, "initial"); assert.sameValue(Object.is(initial, 1), true); assert.sameValue(typeof initial, "number");
const expected: unknown[] = ["declaration.write", 1, "object.read", "initial", 1, 1];
let at = 0;
for (const input of inputs) {
  ({ value: current = 1 } = { value: input }); state.log.push("object.write", current);
  const wanted = input === undefined ? 1 : input;
  const assigned = read(state, "assigned"); assert.sameValue(Object.is(assigned, wanted), true); assert.sameValue(typeof assigned, typeof wanted);
  current = "outside"; state.log.push("top.write", "outside");
  const outside = read(state, "outside"); assert.sameValue(Object.is(outside, "outside"), true); assert.sameValue(typeof outside, "string");
  ({ value: current = 1 } = { value: input }); state.log.push("object.restore", current);
  const restored = read(state, "restored"); assert.sameValue(Object.is(restored, wanted), true); assert.sameValue(typeof restored, typeof wanted);
  expected.push("object.write", wanted, "object.read", "assigned", wanted, at * 3 + 2, "top.write", "outside", "object.read", "outside", "outside", at * 3 + 3, "object.restore", wanted, "object.read", "restored", wanted, at * 3 + 4); at++;
}
const final = current; state.log.push("top.read", final); assert.sameValue(Object.is(final, identity), true); assert.sameValue(typeof final, "object");
assert.sameValue(state.reads, inputs.length * 3 + 1); expected.push("top.read", identity); assert.compareArray(state.log, expected);
