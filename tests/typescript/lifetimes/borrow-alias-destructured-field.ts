/*---
description: Destructured field aliases own a borrow after its original owner slot is overwritten.
features: [ts-lifetime-borrow, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-destructuring]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: destructuring keeps two field aliases; Node reads the same original object after replacement.
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
for (let n = 0; n < 256; n++) {
  const owner = { item: make(n) };
  const { item: kept } = owner;
  const { item: same } = owner;
  owner.item = make(-n - 1);
  churn(n);
  check(kept, same, n);
}
