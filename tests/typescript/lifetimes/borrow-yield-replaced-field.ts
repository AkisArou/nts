/*---
description: A generator frame retains a borrowed field after its owner is replaced between next calls.
features: [ts-lifetime-borrow, ts-route-yield, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-generators]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: yield suspends with two borrowed reads; Node resumes with identical original contents.
type Cell = { id: number; text: string };
function make(id: number): Cell { return { id, text: "cell/" + id }; }
function churn(seed: number): void {
  const rows: Cell[] = [];
  for (let i = 0; i < 24; i++) rows.push(make(seed + 1000 + i));
  let sum = 0;
  for (const row of rows) sum += row.id + row.text.length;
  assert.sameValue(sum, 24 * (seed + 1000) + 492);
}
function check(value: Cell, same: Cell, n: number): void {
  assert.sameValue(value === same, true);
  assert.sameValue(value.id, n);
  assert.sameValue(value.text, "cell/" + n);
  assert.sameValue(value.text.length, ("cell/" + n).length);
}
function* read(owner: { item: Cell }, n: number): Generator<number, void, unknown> {
  const kept = owner.item, same = owner.item;
  yield n;
  check(kept, same, n);
}
for (let n = 0; n < 256; n++) {
  const owner = { item: make(n) };
  const iterator = read(owner, n);
  assert.sameValue(iterator.next().value, n);
  owner.item = make(-n - 1);
  churn(n);
  assert.sameValue(iterator.next().done, true);
}
