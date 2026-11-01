/*---
description: A typed function reader selects a hoisted module function before its declaration for mixed inputs and exact call effects.
features: [ts-scope-route-initialization, ts-modules, ts-functions, ts-function-types, ts-unions]
flags: [module]
---*/
// A function binding is read through select before its declaration; node calls the same hoisted function for every payload.
type InitValue = number | string | undefined | { id: number };
const identity = { id: 9 };
const inputs: InitValue[] = [3, -0, NaN, "text", undefined, identity];
type InitOperation = (state: InitState, value: InitValue) => InitValue;
interface InitState { log: unknown[]; calls: number; ready: boolean; operation: InitOperation | undefined; }
function select(state: InitState): InitOperation {
  const selected = hoisted;
  state.log.push("function.read", selected); return selected;
}
const state: InitState = { log: [], calls: 0, ready: true, operation: undefined };
const expected = hoisted;
for (const value of inputs) {
  state.log.length = 0; const before = state.calls;
  const selected = select(state); assert.sameValue(Object.is(selected, expected), true); assert.sameValue(typeof selected, "function");
  const result = selected(state, value);
  assert.sameValue(Object.is(result, value), true); assert.sameValue(typeof result, typeof value); assert.sameValue(state.calls, before + 1);
  assert.compareArray(state.log, ["function.read", expected, "function.enter", value, "count.write", before + 1, "function.return", value]);
}
function hoisted(state: InitState, value: InitValue): InitValue { state.log.push("function.enter", value); state.calls++; state.log.push("count.write", state.calls, "function.return", value); return value; }
