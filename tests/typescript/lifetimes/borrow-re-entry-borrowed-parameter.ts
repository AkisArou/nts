/*---
description: A borrowed parameter stays valid when a callback recursively replaces its caller-owned slot.
features: [ts-lifetime-borrow, ts-route-re-entry, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-closures]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: a callback enters the same callee with a new slot value; Node keeps the outer parameter intact.
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
function inspect(item: Cell, owner: { item: Cell }, nested: boolean): void {
  const same = item;
  const n = item.id;
  if (!nested) {
    const again = (): void => {
      owner.item = make(n + 500);
      inspect(owner.item, owner, true);
    };
    again();
  }
  churn(n);
  check(item, same, n);
}
for (let n = 0; n < 256; n++) {
  const owner = { item: make(n) };
  inspect(owner.item, owner, false);
}
