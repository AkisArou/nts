/*---
description: A finally block must retain a field borrow while releasing its original anchor.
features: [ts-lifetime-borrow, ts-route-throw, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-errors]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: finally saves the borrowed field during unwinding; Node keeps it after the owner is replaced.
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
function leave(owner: { item: Cell }, saved: Cell[]): never {
  const item = owner.item;
  try { throw new Error("leave"); }
  finally { saved.push(item, item); owner.item = make(-1); }
}
for (let n = 0; n < 256; n++) {
  const owner = { item: make(n) };
  const saved: Cell[] = [];
  assert.throws(Error, () => leave(owner, saved));
  churn(n);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
