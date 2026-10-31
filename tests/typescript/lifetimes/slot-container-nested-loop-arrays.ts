/*---
description: Outer-loop arrays preserve every inner-loop object and its identity.
features: [ts-lifetime-slot, ts-route-container, ts-functions, ts-strings, ts-objects, ts-arrays]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: an outer batch stores inner-loop objects whose lifetimes overlap. Node preserves every retained iteration.
type Cell = { id: number; score: number; text: string };
function check(value: Cell, identity: Cell, id: number): void {
  assert.sameValue(value === identity, true);
  assert.sameValue(value.id, id);
  assert.sameValue(value.score, id * 5 + 1);
  assert.sameValue(value.text, "slot:" + id);
  assert.sameValue(value.text.length, 5 + String(id).length);
}
function make(n: number): Cell[][] {
  const batches: Cell[][] = [];
  for (let outer = 0; outer < 2; outer++) {
    const batch: Cell[] = [];
    for (let inner = 0; inner < 3; inner++) {
      const id = n * 8 + outer * 3 + inner;
      const value = { id, score: id * 5 + 1, text: "slot:" + id };
      assert.sameValue(value.score - value.id * 5, 1);
      batch.push(value, value);
    }
    batches.push(batch);
  }
  return batches;
}
for (let n = 0; n < 240; n++) {
  const saved = make(n);
  for (let k = 0; k < 4; k++) {
    const fresh = make(n + 512 + k);
    check(fresh[1][4], fresh[1][5], (n + 512 + k) * 8 + 5);
  }
  assert.sameValue(saved.length, 2);
  for (let outer = 0; outer < 2; outer++) {
    assert.sameValue(saved[outer].length, 6);
    for (let inner = 0; inner < 3; inner++) {
      check(saved[outer][inner * 2], saved[outer][inner * 2 + 1], n * 8 + outer * 3 + inner);
    }
  }
}
