/*---
description: Array push must retain a borrowed field independently of its source slot.
features: [ts-lifetime-borrow, ts-route-container, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: two array entries keep the borrow after the source is replaced; Node keeps their identity.
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
function collect(owner: { item: Cell }, saved: Cell[]): void {
  const item = owner.item;
  saved.push(item);
  saved.push(item);
}
for (let n = 0; n < 256; n++) {
  const owner = { item: make(n) };
  const saved: Cell[] = [];
  collect(owner, saved);
  owner.item = make(-n - 1);
  churn(n);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
