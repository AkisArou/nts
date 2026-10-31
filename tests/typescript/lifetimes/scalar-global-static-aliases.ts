/*---
description: Static stores preserve shared writes to a local three-field object.
features: [ts-lifetime-scalar, ts-route-global, ts-functions, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-static]
---*/
// Fact: field-only objects become locals (docs/foundations/memory.md, "Where nts stands").
// Route: static fields publish one identity; Node sees later numeric and boolean writes through both slots.
type State = { x: number; y: number; active: boolean };
class Saved { static first: State | null = null; static second: State | null = null; }
function prepare(n: number, publish: boolean): number {
  const state = { x: n, y: n + 17, active: true };
  state.y += state.x;
  if (publish) { Saved.first = state; Saved.second = state; }
  return state.x + state.y;
}
for (let n = 0; n < 240; n++) {
  assert.sameValue(prepare(n, true), 3 * n + 17);
  for (let j = 1; j <= 16; j++) assert.sameValue(prepare(n + j, false), 3 * (n + j) + 17);
  const first = Saved.first, second = Saved.second;
  if (first === null || second === null) throw new Error("missing static value");
  assert.sameValue(first === second, true);
  assert.sameValue(first.x, n);
  assert.sameValue(first.y, 2 * n + 17);
  assert.sameValue(first.active, true);
  first.x += 31;
  second.y -= 7;
  second.active = false;
  assert.sameValue(second.x, n + 31);
  assert.sameValue(first.y, 2 * n + 10);
  assert.sameValue(first.active, false);
  Saved.first = null; Saved.second = null;
}
