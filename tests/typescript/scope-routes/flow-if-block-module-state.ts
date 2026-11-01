/*---
description: Top-level if block bindings retain their own mixed writes while typed readers observe later module-state writes.
features: [ts-scope-route-control-flow, ts-modules, ts-functions, ts-function-types, ts-closures, ts-unions, ts-numbers, ts-strings, ts-objects, ts-arrays]
flags: [module]
---*/
// Route: readers outlive top-level if blocks and read both their typed block binding and module current; node retains each block value and sees later global writes.
type FlowValue = number | string | undefined | { id: number };
const identity = { id: 7 }; const inputs: FlowValue[] = [0, -0, NaN, 0.5, 2147483648, "", "中", undefined, identity];
interface FlowState { current: FlowValue; values: FlowValue[]; log: unknown[]; reads: number; }
let current: FlowValue = 1;
const state: FlowState = { current: 1, values: [], log: ["module.init", 1], reads: 0 };
const readers: ((state: FlowState, slot: number) => [FlowValue, FlowValue])[] = [];
for (let at = 0; at < inputs.length; at++) {
  let read: (state: FlowState, slot: number) => [FlowValue, FlowValue];
  if (at % 2 === 0) {
      let chosen: FlowValue = 1; state.log.push("if.then.init", chosen);
      read = (state, slot) => { const seen: [FlowValue, FlowValue] = [chosen, current]; state.reads++; state.log.push("if.then.read", seen[0], seen[1], state.reads); return seen; };
      chosen = inputs[at]; state.log.push("if.then.write", chosen);
  } else {
      let chosen: FlowValue = "seed"; state.log.push("if.else.init", chosen);
      read = (state, slot) => { const seen: [FlowValue, FlowValue] = [chosen, current]; state.reads++; state.log.push("if.else.read", seen[0], seen[1], state.reads); return seen; };
      chosen = inputs[at]; state.log.push("if.else.write", chosen);
  }
  current = inputs[at]; state.log.push("module.write", current); readers.push(read); const seen = read(state, at);
  for (const observed of seen) { assert.sameValue(Object.is(observed, inputs[at]), true); assert.sameValue(typeof observed, typeof inputs[at]); }
}
current = undefined; state.log.push("top.write", undefined);
for (let slot = 0; slot < readers.length; slot++) {
  const seen = readers[slot](state, slot);
  assert.sameValue(Object.is(seen[0], inputs[slot]), true); assert.sameValue(typeof seen[0], typeof inputs[slot]);
  assert.sameValue(Object.is(seen[1], undefined), true); assert.sameValue(typeof seen[1], "undefined");
}
const final = current; state.log.push("top.read", final); assert.sameValue(Object.is(final, undefined), true); assert.sameValue(typeof final, "undefined");
assert.sameValue(state.reads, inputs.length * 2);
const labels: string[] = ["then", "else"]; const initial: FlowValue[] = [1, "seed"]; const expected: unknown[] = ["module.init", 1];
for (let slot = 0; slot < inputs.length; slot++) { const branch = slot % 2; expected.push("if." + labels[branch] + ".init", initial[branch], "if." + labels[branch] + ".write", inputs[slot], "module.write", inputs[slot], "if." + labels[branch] + ".read", inputs[slot], inputs[slot], slot + 1); }
expected.push("top.write", undefined);
for (let slot = 0; slot < inputs.length; slot++) expected.push("if." + labels[slot % 2] + ".read", inputs[slot], undefined, inputs.length + slot + 1);
expected.push("top.read", undefined); assert.compareArray(state.log, expected);
