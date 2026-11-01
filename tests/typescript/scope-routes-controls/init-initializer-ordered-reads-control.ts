/*---
description: A typed initializer reads an earlier module let, var and const object in order and later observes changed fields and bindings. (explicit-state control)
features: [ts-scope-route-initialization, ts-modules, ts-functions, ts-arrays, ts-unions]
flags: [module]
---*/
// A top-level array initializer calls a typed reader of earlier bindings; node reads let, var and const object in source order.
type InitValue = number | string | undefined | { id: number };
const identity = { id: 9 };
const inputs: InitValue[] = [3, -0, NaN, "text", undefined, identity];
interface InitState { log: unknown[]; first: InitValue; second: InitValue; holder: { value: InitValue }; }
function snapshot(state: InitState): InitValue[] {
  const first = state.first; state.log.push("initializer.first", first);
  const second = state.second; state.log.push("initializer.second", second);
  const holder = state.holder; state.log.push("initializer.holder", holder);
  const held = holder.value; state.log.push("initializer.value", held); return [first, second, held];
}
const state: InitState = { log: [], first: 1, second: "before", holder: { value: identity } };

const initial: InitValue[] = snapshot(state);
for (let index = 0; index < initial.length; index++) { const expected = [1, "before", identity][index]; assert.sameValue(Object.is(initial[index], expected), true); assert.sameValue(typeof initial[index], typeof expected); }
assert.compareArray(state.log, ["initializer.first", 1, "initializer.second", "before", "initializer.holder", state.holder, "initializer.value", identity]);
for (const value of inputs) {
  state.log.length = 0; state.first = value; state.log.push("driver.first", value); state.second = undefined; state.log.push("driver.second", undefined); state.holder.value = value; state.log.push("driver.value", value);
  const results = snapshot(state); const expected: InitValue[] = [value, undefined, value]; assert.sameValue(results.length, 3);
  for (let index = 0; index < results.length; index++) { assert.sameValue(Object.is(results[index], expected[index]), true); assert.sameValue(typeof results[index], typeof expected[index]); }
  assert.compareArray(state.log, ["driver.first", value, "driver.second", undefined, "driver.value", value, "initializer.first", value, "initializer.second", undefined, "initializer.holder", state.holder, "initializer.value", value]);
}
assert.compareArray(initial, [1, "before", identity]);
