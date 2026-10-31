/*---
description: A spread getter retains the source object during its immutable update.
features: [ts-lifetime-in-place, ts-route-hook, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-accessors, ts-spread]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: a getter publishes the source before assignment; Node preserves its old fields and identity.
type State = { x: number; y: number };
function make(n: number): State { return { x: n, y: -n }; }
function churn(n: number): void {
  const all: State[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000));
  for (const value of all) assert.sameValue(value.x + value.y, 0);
}

for (let n = 0; n < 240; n++) {
  let state = make(n);
  const saved: { value: State | null } = { value: null };
  const change = { get x(): number { saved.value = state; return n + 100; } };
  state = { ...state, ...change };
  const witness = saved.value;
  churn(n);
  const old = saved.value;
  if (old === null) throw new Error("getter did not run");
  assert.sameValue(old === witness, true);
  assert.sameValue(old === state, false);
  assert.sameValue(old.x, n); assert.sameValue(old.y, -n);
  assert.sameValue(state.x, n + 100); assert.sameValue(state.y, -n);
}
