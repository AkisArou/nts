/*---
description: An implicit getter retains each loop object before later allocations.
features: [ts-lifetime-slot, ts-route-hook, ts-functions, ts-strings, ts-objects, ts-accessors, ts-closures, ts-arrays]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: the getter publishes the current object beyond its loop iteration. Node preserves every retained iteration.
type Cell = { id: number; score: number; text: string };
function check(value: Cell, identity: Cell, id: number): void {
  assert.sameValue(value === identity, true);
  assert.sameValue(value.id, id);
  assert.sameValue(value.score, id * 5 + 1);
  assert.sameValue(value.text, "slot:" + id);
  assert.sameValue(value.text.length, 5 + String(id).length);
}
function make(n: number): Cell[] {
  const saved: Cell[] = [];
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const value = { id, score: id * 5 + 1, text: "slot:" + id };
    assert.sameValue(value.score - value.id * 5, 1);
    const hook = { get snapshot(): number {
      saved.push(value, value);
      return value.score;
    } };
    assert.sameValue(hook.snapshot, id * 5 + 1);
  }
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = make(n);
  for (let k = 0; k < 4; k++) {
    const fresh = make(n + 512 + k);
    check(fresh[10], fresh[11], (n + 512 + k) * 8 + 5);
  }
  assert.sameValue(saved.length, 12);
  for (let i = 0; i < 6; i++) check(saved[i * 2], saved[i * 2 + 1], n * 8 + i);
}
