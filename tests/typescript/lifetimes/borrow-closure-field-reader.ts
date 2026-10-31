/*---
description: A captured field borrow survives replacement of its original owner slot.
features: [ts-lifetime-borrow, ts-route-closure, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-closures, ts-tuples]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: a returned reader retains the field; Node preserves its identity and both fields.
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
function retain(owner: { item: Cell }): [() => Cell, () => Cell] {
  const item = owner.item;
  return [() => item, () => item];
}
for (let n = 0; n < 256; n++) {
  const owner = { item: make(n) };
  const readers = retain(owner);
  owner.item = make(-n - 1);
  churn(n);
  check(readers[0](), readers[1](), n);
}
