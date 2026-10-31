/*---
description: Object.assign creates an alias that survives an immutable object replacement.
features: [ts-lifetime-in-place, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-spread]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: assign copies a reference before its first name is dropped; Node keeps both original fields and identity.
type State = { x: number; y: number };
function make(n: number): State { return { x: n, y: -n }; }
function churn(n: number): void {
  const all: State[] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000));
  for (const value of all) assert.sameValue(value.x + value.y, 0);
}

for (let n = 0; n < 240; n++) {
  let state = make(n);
  const alias = Object.assign({ value: make(-1) }, { value: state });
  state = { ...state, x: n + 100 };
  const witness = alias.value;
  churn(n);
  const old = alias.value;
  assert.sameValue(old === witness, true);
  assert.sameValue(old === state, false);
  assert.sameValue(old.x, n); assert.sameValue(old.y, -n);
  assert.sameValue(state.x, n + 100); assert.sameValue(state.y, -n);
}
