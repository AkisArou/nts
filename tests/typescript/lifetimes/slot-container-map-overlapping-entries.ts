/*---
description: Map entries preserve all objects made at one loop allocation site.
features: [ts-lifetime-slot, ts-route-container, ts-functions, ts-strings, ts-objects, ts-map-set]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: two Map keys retain each instance while later iterations allocate. Node preserves every retained iteration.
type Cell = { id: number; score: number; text: string };
function check(value: Cell, identity: Cell, id: number): void {
  assert.sameValue(value === identity, true);
  assert.sameValue(value.id, id);
  assert.sameValue(value.score, id * 5 + 1);
  assert.sameValue(value.text, "slot:" + id);
  assert.sameValue(value.text.length, 5 + String(id).length);
}
function make(n: number): Map<number, Cell> {
  const saved = new Map<number, Cell>();
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const value = { id, score: id * 5 + 1, text: "slot:" + id };
    assert.sameValue(value.score - value.id * 5, 1);
    saved.set(i * 2, value);
    saved.set(i * 2 + 1, value);
  }
  return saved;
}
function inspect(saved: Map<number, Cell>, n: number): void {
  assert.sameValue(saved.size, 12);
  for (let i = 0; i < 6; i++) {
    const value = saved.get(i * 2);
    const identity = saved.get(i * 2 + 1);
    if (value === undefined || identity === undefined) throw new Test262Error("missing entry");
    check(value, identity, n * 8 + i);
  }
}
for (let n = 0; n < 240; n++) {
  const saved = make(n);
  for (let k = 0; k < 4; k++) inspect(make(n + 512 + k), n + 512 + k);
  inspect(saved, n);
  saved.clear();
}
