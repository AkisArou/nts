/*---
description: Successive iterator results preserve distinct immutable states.
features: [ts-lifetime-in-place, ts-route-iterator, ts-functions, ts-iteration, ts-objects, ts-spread, ts-arrays]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: next hands out each pre-update state; Node keeps every result distinct after later next calls.
type State = { x: number; y: number };
function make(n: number): State { return { x: n, y: -n }; }
function churn(n: number): void {
  const all: State[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000));
  for (const value of all) assert.sameValue(value.x + value.y, 0);
}

function states(n: number): Iterator<State> {
  let state = make(n);
  let started = false;
  return { next(): IteratorResult<State> {
    if (started) state = { ...state, x: state.x + 1 };
    started = true;
    return { done: false, value: state };
  } };
}
for (let n = 0; n < 240; n++) {
  const iterator = states(n);
  const first = iterator.next();
  if (first.done) throw new Error("missing first");
  const second = iterator.next();
  if (second.done) throw new Error("missing second");
  for (let i = 0; i < 24; i++) {
    const busy = iterator.next();
    if (busy.done) throw new Error("missing churn value");
    assert.sameValue(busy.value.x, n + i + 2);
    assert.sameValue(busy.value.y, -n);
  }
  const witness = first.value;
  churn(n);
  assert.sameValue(first.value === witness, true);
  assert.sameValue(first.value === second.value, false);
  assert.sameValue(first.value.x, n); assert.sameValue(first.value.y, -n);
  assert.sameValue(second.value.x, n + 1); assert.sameValue(second.value.y, -n);
}
