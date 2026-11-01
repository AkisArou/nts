/*---
description: A typed module initializer reads and replaces an earlier var while returning its exact value for mixed inputs.
features: [ts-scope-route-initialization, ts-modules, ts-functions, ts-unions]
flags: [module]
---*/
// A top-level initializer calls a typed writer of an earlier var; node exposes the write both to the return and subsequent reads.
type InitValue = number | string | undefined | { id: number };
const identity = { id: 9 };
const inputs: InitValue[] = [3, -0, NaN, "text", undefined, identity];
interface InitState { log: unknown[]; value: InitValue; writes: number; }
function initialize(state: InitState, next: InitValue): InitValue {
  const before = earlierValue; state.log.push("initializer.before", before);
  earlierValue = next; state.writes++; state.log.push("initializer.write", next, state.writes);
  const after = earlierValue; state.log.push("initializer.after", after); return after;
}
const state: InitState = { log: [], value: 1, writes: 0 };
var earlierValue: InitValue = 1;
const initial: InitValue = initialize(state, identity);
assert.sameValue(Object.is(initial, identity), true); assert.sameValue(typeof initial, "object");
assert.compareArray(state.log, ["initializer.before", 1, "initializer.write", identity, 1, "initializer.after", identity]);
let previous: InitValue = identity;
for (let index = 0; index < inputs.length; index++) {
  const value = inputs[index]; state.log.length = 0; const result = initialize(state, value);
  assert.sameValue(Object.is(result, value), true); assert.sameValue(typeof result, typeof value);
  assert.sameValue(Object.is(earlierValue, value), true); assert.sameValue(typeof earlierValue, typeof value);
  assert.compareArray(state.log, ["initializer.before", previous, "initializer.write", value, index + 2, "initializer.after", value]); previous = value;
}
assert.sameValue(state.writes, inputs.length + 1); assert.sameValue(Object.is(initial, identity), true);
