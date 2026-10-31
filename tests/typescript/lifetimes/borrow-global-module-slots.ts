/*---
description: Module slots keep a borrowed parameter after its caller drops the owner.
features: [ts-lifetime-borrow, ts-route-global, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-modules]
flags: [module]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: the callee publishes two references; Node reads the same object after the caller exits.
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
let kept: Cell = make(-1);
let witness: Cell = kept;
function publish(item: Cell): void { kept = item; witness = item; }
function prepare(n: number): void {
  const owner = { item: make(n) };
  assert.sameValue(owner.item.id, n);
  publish(owner.item);
  owner.item = make(-n - 1);
}
for (let n = 0; n < 256; n++) {
  prepare(n);
  churn(n);
  check(kept, witness, n);
}
