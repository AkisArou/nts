/*---
description: Caught payloads preserve distinct loop objects across later allocations.
features: [ts-lifetime-slot, ts-route-throw, ts-functions, ts-strings, ts-objects, ts-errors, ts-class, ts-class-fields, ts-instanceof, ts-narrowing, ts-arrays]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: a callee throws each object into a payload retained beyond its iteration. Node preserves every retained iteration.
type Cell = { id: number; score: number; text: string };
function check(value: Cell, identity: Cell, id: number): void {
  assert.sameValue(value === identity, true);
  assert.sameValue(value.id, id);
  assert.sameValue(value.score, id * 5 + 1);
  assert.sameValue(value.text, "slot:" + id);
  assert.sameValue(value.text.length, 5 + String(id).length);
}
class Payload {
  value: Cell;
  identity: Cell;
  constructor(value: Cell) { this.value = value; this.identity = value; }
}
function raise(value: Cell): never { throw new Payload(value); }
function make(n: number): Payload[] {
  const saved: Payload[] = [];
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const value = { id, score: id * 5 + 1, text: "slot:" + id };
    assert.sameValue(value.score - value.id * 5, 1);
    try { raise(value); } catch (error) {
      if (!(error instanceof Payload)) throw error;
      saved.push(error);
    }
  }
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = make(n);
  for (let k = 0; k < 4; k++) {
    const fresh = make(n + 512 + k);
    check(fresh[5].value, fresh[5].identity, (n + 512 + k) * 8 + 5);
  }
  assert.sameValue(saved.length, 6);
  for (let i = 0; i < 6; i++) check(saved[i].value, saved[i].identity, n * 8 + i);
}
