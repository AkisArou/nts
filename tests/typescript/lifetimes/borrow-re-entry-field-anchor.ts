/*---
description: A borrowed field stays valid when a callback re-enters its reader after replacing the anchor.
features: [ts-lifetime-borrow, ts-route-re-entry, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-closures]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: re-entry replaces the source slot while the outer read remains live; Node preserves both invocations.
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
function read(owner: { item: Cell }, depth: number): void {
  const kept = owner.item, same = owner.item;
  const n = kept.id;
  if (depth > 0) {
    const again = (): void => {
      owner.item = make(n + 500);
      read(owner, depth - 1);
    };
    again();
  }
  churn(n);
  check(kept, same, n);
}
for (let n = 0; n < 256; n++) read({ item: make(n) }, 1);
