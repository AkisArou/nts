/*---
description: A retained typed constructor reader rejects repeated class TDZ access and constructs mixed values after module initialization.
features: [ts-scope-route-initialization, ts-modules, ts-functions, ts-function-types, ts-class, ts-errors, ts-unknown, ts-unions]
flags: [module]
---*/
// A nested reader retains the module class binding; node rejects both early reads and returns the class after its declaration.
type InitValue = number | string | undefined | { id: number };
const identity = { id: 9 };
const inputs: InitValue[] = [3, -0, NaN, "text", undefined, identity];
interface InitItem { value: InitValue; }
type InitConstructor = new (state: InitState, value: InitValue) => InitItem;
interface InitState { log: unknown[]; reads: number; initialized: boolean; constructorValue: InitConstructor | undefined; }
function makeReader(): (state: InitState) => InitConstructor {
  return state => { state.reads++; state.log.push("class.attempt", state.reads); const selected = Later; state.log.push("class.read", selected); return selected; };
}
function probe(state: InitState, reader: (state: InitState) => InitConstructor): () => void {
  return () => { try { reader(state); } catch (error: unknown) { assert.sameValue(error instanceof ReferenceError, true); if (!(error instanceof ReferenceError)) throw error; state.log.push("caught", error.message); throw error; } };
}
const state: InitState = { log: [], reads: 0, initialized: false, constructorValue: undefined };
const reader = makeReader();
for (const attempt of [0, 1]) assert.throws(ReferenceError, probe(state, reader));
class Later { value: InitValue; constructor(state: InitState, value: InitValue) { this.value = value; state.log.push("instance.write", value); } }

state.initialized = true; state.log.push("class.initialize", Later);
const expected: unknown[] = ["class.attempt", 1, "caught", "Cannot access 'Later' before initialization", "class.attempt", 2, "caught", "Cannot access 'Later' before initialization", "class.initialize", Later];
for (let index = 0; index < inputs.length; index++) {
  const selected = reader(state); assert.sameValue(Object.is(selected, Later), true); assert.sameValue(typeof selected, "function");
  const value = inputs[index]; const instance = new selected(state, value);
  assert.sameValue(Object.is(instance.value, value), true); assert.sameValue(typeof instance.value, typeof value);
  expected.push("class.attempt", index + 3, "class.read", Later, "instance.write", value);
}
assert.sameValue(state.reads, inputs.length + 2); assert.compareArray(state.log, expected);
