/*---
description: Successive next results retain distinct objects from a generator loop.
features: [ts-lifetime-slot, ts-route-iterator, ts-functions, ts-strings, ts-objects, ts-generators, ts-iteration, ts-tuples, ts-arrays]
---*/
// Fact: loop instances may share a frame slot only if disjoint (docs/foundations/memory.md, Where nts stands).
// Route: each next result keeps its loop object when next resumes the next iteration. Node preserves every retained iteration.
type Cell = { id: number; score: number; text: string };
function check(value: Cell, identity: Cell, id: number): void {
  assert.sameValue(value === identity, true);
  assert.sameValue(value.id, id);
  assert.sameValue(value.score, id * 5 + 1);
  assert.sameValue(value.text, "slot:" + id);
  assert.sameValue(value.text.length, 5 + String(id).length);
}
function* make(n: number): Generator<[Cell, Cell], void, unknown> {
  for (let i = 0; i < 6; i++) {
    const id = n * 8 + i;
    const value = { id, score: id * 5 + 1, text: "slot:" + id };
    assert.sameValue(value.score - value.id * 5, 1);
    yield [value, value];
  }
}
function keep(n: number): [Cell, Cell][] {
  const iterator = make(n);
  const saved: [Cell, Cell][] = [];
  for (let i = 0; i < 6; i++) {
    const result = iterator.next();
    if (result.done) throw new Test262Error("short iterator");
    saved.push(result.value);
  }
  assert.sameValue(iterator.next().done, true);
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = keep(n);
  for (let k = 0; k < 4; k++) {
    const fresh = keep(n + 512 + k);
    check(fresh[5][0], fresh[5][1], (n + 512 + k) * 8 + 5);
  }
  for (let i = 0; i < 6; i++) check(saved[i][0], saved[i][1], n * 8 + i);
}
