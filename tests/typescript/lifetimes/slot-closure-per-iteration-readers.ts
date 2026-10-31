/*---
description: Delayed closures preserve distinct objects from one loop allocation site.
features: [ts-lifetime-slot, ts-route-closure, ts-functions, ts-strings, ts-objects, ts-closures, ts-tuples, ts-arrays]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: paired closures retain each loop object while later iterations allocate. Node preserves every retained iteration.
type Cell = { id: number; score: number; text: string };
function check(value: Cell, identity: Cell, id: number): void {
  assert.sameValue(value === identity, true);
  assert.sameValue(value.id, id);
  assert.sameValue(value.score, id * 5 + 1);
  assert.sameValue(value.text, "slot:" + id);
  assert.sameValue(value.text.length, 5 + String(id).length);
}
function make(n: number): [() => Cell, () => Cell][] {
  const saved: [() => Cell, () => Cell][] = [];
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const value = { id, score: id * 5 + 1, text: "slot:" + id };
    assert.sameValue(value.score - value.id * 5, 1);
    const identity = value;
    saved.push([() => value, () => identity]);
  }
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = make(n);
  for (let k = 0; k < 4; k++) {
    const fresh = make(n + 512 + k);
    for (let i = 0; i < 6; i++) check(fresh[i][0](), fresh[i][1](), (n + 512 + k) * 8 + i);
  }
  assert.sameValue(saved.length, 6);
  for (let i = 0; i < 6; i++) check(saved[i][0](), saved[i][1](), n * 8 + i);
}
