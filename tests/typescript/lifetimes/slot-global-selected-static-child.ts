/*---
description: A selected loop object published in static fields survives later instances.
features: [ts-lifetime-slot, ts-route-global, ts-functions, ts-strings, ts-objects, ts-class, ts-class-fields, ts-static]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: static fields retain iteration one while the same site allocates four more. Node preserves every retained iteration.
type Cell = { id: number; score: number; text: string };
function check(value: Cell, identity: Cell, id: number): void {
  assert.sameValue(value === identity, true);
  assert.sameValue(value.id, id);
  assert.sameValue(value.score, id * 5 + 1);
  assert.sameValue(value.text, "slot:" + id);
  assert.sameValue(value.text.length, 5 + String(id).length);
}
class Saved {
  static value: Cell | undefined;
  static identity: Cell | undefined;
}
function visit(n: number, keep: boolean): void {
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const value = { id, score: id * 5 + 1, text: "slot:" + id };
    assert.sameValue(value.score - value.id * 5, 1);
    if (keep && i === 1) { Saved.value = value; Saved.identity = value; }
  }
}
for (let n = 0; n < 240; n++) {
  visit(n, true);
  for (let k = 0; k < 4; k++) visit(n + 512 + k, false);
  const value = Saved.value;
  const identity = Saved.identity;
  if (value === undefined || identity === undefined) throw new Test262Error("not retained");
  check(value, identity, n * 8 + 1);
  Saved.value = undefined;
  Saved.identity = undefined;
}
