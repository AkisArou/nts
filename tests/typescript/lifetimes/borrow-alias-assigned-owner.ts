/*---
description: Object.assign copies must retain the source owner field they borrow.
features: [ts-lifetime-borrow, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: two shallow owner copies keep the field after source replacement; Node preserves its identity.
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
  const kept = Object.assign({}, owner);
  const same = Object.assign({}, owner);
  owner.item = make(-n - 1);
  churn(n);
  check(kept.item, same.item, n);
}
