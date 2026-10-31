/*---
description: A map callback must retain the borrowed element it saves beyond its owner.
features: [ts-lifetime-borrow, ts-route-callback, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-closures]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: map passes an element to a saving callback; Node keeps both aliases after truncation.
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
  const source = [make(n)];
  const saved: Cell[] = [];
  const ids = source.map(item => { saved.push(item, item); return item.id; });
  assert.sameValue(ids[0], n);
  source.length = 0;
  churn(n);
  check(saved[0], saved[1], n);
}
