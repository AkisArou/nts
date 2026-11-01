/*---
description: An indirect typed var reader observes undefined before the module assignment and every later representation-changing write. (explicit-state control)
features: [ts-scope-route-initialization, ts-modules, ts-functions, ts-unions]
flags: [module]
---*/
// The module var is read before assignment, then rewritten; node first returns undefined and later the exact stored payload.
type InitValue = number | string | undefined | { id: number };
const identity = { id: 9 };
const inputs: InitValue[] = [3, -0, NaN, "text", undefined, identity];
interface InitState { log: unknown[]; reads: number; initialized: boolean; value: InitValue; }
function readValue(state: InitState): InitValue { const value = state.initialized ? state.value : undefined; state.reads++; state.log.push("var.read", state.reads, value); return value; }
const state: InitState = { log: [], reads: 0, initialized: false, value: undefined };
for (const attempt of [1, 2]) { const value = readValue(state); assert.sameValue(Object.is(value, undefined), true); assert.sameValue(typeof value, "undefined"); }
state.value = 1;
state.initialized = true; state.log.push("var.initialize", 1);
const initialized = readValue(state); assert.sameValue(Object.is(initialized, 1), true); assert.sameValue(typeof initialized, "number");
const expected: unknown[] = ["var.read", 1, undefined, "var.read", 2, undefined, "var.initialize", 1, "var.read", 3, 1];
for (let index = 0; index < inputs.length; index++) {
  const value = inputs[index]; state.value = value; state.log.push("var.write", value);
  const result = readValue(state); assert.sameValue(Object.is(result, value), true); assert.sameValue(typeof result, typeof value);
  expected.push("var.write", value, "var.read", index + 4, value);
}
assert.sameValue(state.reads, inputs.length + 3); assert.compareArray(state.log, expected);
