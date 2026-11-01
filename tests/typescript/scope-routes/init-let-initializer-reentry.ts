/*---
description: A typed initializer reads its own module let before initialization and later typed reads observe every replacement.
features: [ts-scope-route-initialization, ts-modules, ts-functions, ts-function-types, ts-errors, ts-unknown, ts-unions]
flags: [module]
---*/
// The module let is still uninitialized inside its initializer; node throws on reentry and preserves later mixed writes.
type InitValue = number | string | undefined | { id: number };
const identity = { id: 9 };
const inputs: InitValue[] = [3, -0, NaN, "text", undefined, identity];
interface InitState { log: unknown[]; initialized: boolean; value: InitValue; reads: number; }
function initialize(state: InitState, seed: InitValue): InitValue {
  state.log.push("initializer.enter", seed);
  const probe = () => { state.log.push("initializer.read"); try { const previous = laterValue; state.log.push("unexpected", previous); } catch (error: unknown) { assert.sameValue(error instanceof ReferenceError, true); if (!(error instanceof ReferenceError)) throw error; state.log.push("caught", error.message); throw error; } };
  assert.throws(ReferenceError, probe); state.log.push("initializer.return", seed); return seed;
}
function readValue(state: InitState): InitValue { const result = laterValue; state.reads++; state.log.push("later.read", state.reads, result); return result; }
const state: InitState = { log: [], initialized: false, value: undefined, reads: 0 };
let laterValue: InitValue = initialize(state, identity);
state.initialized = true; const initialized = readValue(state); assert.sameValue(Object.is(initialized, identity), true); assert.sameValue(typeof initialized, "object"); state.log.push("initialized", initialized);
assert.compareArray(state.log, ["initializer.enter", identity, "initializer.read", "caught", "Cannot access 'laterValue' before initialization", "initializer.return", identity, "later.read", 1, identity, "initialized", identity]);
for (let index = 0; index < inputs.length; index++) {
  const value = inputs[index]; state.log.length = 0; laterValue = value; state.log.push("later.write", value);
  const result = readValue(state); assert.sameValue(Object.is(result, value), true); assert.sameValue(typeof result, typeof value);
  assert.compareArray(state.log, ["later.write", value, "later.read", index + 2, value]);
}
assert.sameValue(state.reads, inputs.length + 1);
