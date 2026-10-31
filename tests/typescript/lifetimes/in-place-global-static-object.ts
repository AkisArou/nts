/*---
description: A static slot retains an object before an immutable field update.
features: [ts-lifetime-in-place, ts-route-global, ts-functions, ts-iteration, ts-objects, ts-class, ts-static, ts-spread]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: a static field retains the old state; Node keeps its identity and both original fields.
type State = { x: number; y: number };
function make(n: number): State { return { x: n, y: -n }; }
function churn(n: number): void {
  const all: State[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000));
  for (const value of all) assert.sameValue(value.x + value.y, 0);
}

class Saved { static value: State | null = null; }
function update(n: number, keep: boolean): State {
  let state = make(n);
  if (keep) Saved.value = state;
  state = { ...state, x: n + 100 };
  return state;
}
for (let n = 0; n < 240; n++) {
  const updated = update(n, true);
  const witness = Saved.value;
  churn(n);
  const old = Saved.value;
  if (old === null) throw new Error("missing state");
  assert.sameValue(old === witness, true);
  assert.sameValue(old === updated, false);
  assert.sameValue(old.x, n); assert.sameValue(old.y, -n);
  assert.sameValue(updated.x, n + 100); assert.sameValue(updated.y, -n);
  Saved.value = null;
}
