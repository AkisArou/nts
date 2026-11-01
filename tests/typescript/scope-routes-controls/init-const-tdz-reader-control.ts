/*---
description: A typed const reader rejects repeated predeclaration access and preserves exact values after module initialization. (explicit-state control)
features: [ts-scope-route-initialization, ts-modules, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-unions]
flags: [module]
---*/
// The module const crosses a typed reader before and after initialization; node throws ReferenceError until the declaration runs.
type InitValue = number | string | undefined | { id: number };
const identity = { id: 9 };
const inputs: InitValue[] = [3, -0, NaN, "text", undefined, identity];
interface InitState { log: unknown[]; reads: number; initialized: boolean; values: readonly InitValue[]; }
function readValue(state: InitState, index: number): InitValue {
  state.reads++; state.log.push("read.attempt", state.reads, index);
  if (!state.initialized) throw new ReferenceError("Cannot access 'laterValues' before initialization"); const result = state.values[index];
  state.log.push("read.value", result); return result;
}
function probe(state: InitState, reader: (state: InitState, index: number) => InitValue, index: number): () => void {
  return () => { try { reader(state, index); } catch (error: unknown) { assert.sameValue(error instanceof ReferenceError, true); if (!(error instanceof ReferenceError)) throw error; state.log.push("caught", error.message); throw error; } };
}
const state: InitState = { log: [], reads: 0, initialized: false, values: [] };
for (const index of [0, 1]) assert.throws(ReferenceError, probe(state, readValue, index));
state.values = inputs;
state.initialized = true; state.log.push("initialized");
const expected: unknown[] = ["read.attempt", 1, 0, "caught", "Cannot access 'laterValues' before initialization", "read.attempt", 2, 1, "caught", "Cannot access 'laterValues' before initialization", "initialized"];
for (let index = 0; index < inputs.length; index++) {
  const value = inputs[index];
  const result = readValue(state, index); assert.sameValue(Object.is(result, value), true); assert.sameValue(typeof result, typeof value);
  expected.push("read.attempt", index + 3, index, "read.value", value);
}
assert.sameValue(state.reads, inputs.length + 2); assert.compareArray(state.log, expected);
