/*---
description: A generator local retains its identity after its former owner is replaced.
features: [ts-lifetime-in-place, ts-route-yield, ts-functions, ts-iteration, ts-objects, ts-generators, ts-spread, ts-arrays]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: only the suspended generator keeps the source; Node returns its original fields and identity.
type State = { x: number; y: number };
function make(n: number): State { return { x: n, y: -n }; }
function churn(n: number): void {
  const all: State[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000));
  for (const value of all) assert.sameValue(value.x + value.y, 0);
}

function* hold(state: State): Generator<number, { value: State; identity: State }, unknown> {
  yield 0;
  return { value: state, identity: state };
}
for (let n = 0; n < 240; n++) {
  let state = make(n);
  const reader = hold(state);
  assert.sameValue(reader.next().value, 0);
  state = { ...state, x: n + 100 };
  churn(n);
  const done = reader.next();
  if (!done.done) throw new Error("not complete");
  assert.sameValue(done.value.value === done.value.identity, true);
  assert.sameValue(done.value.value === state, false);
  assert.sameValue(done.value.value.x, n); assert.sameValue(done.value.value.y, -n);
  assert.sameValue(state.x, n + 100); assert.sameValue(state.y, -n);
}
