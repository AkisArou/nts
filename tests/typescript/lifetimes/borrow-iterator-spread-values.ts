/*---
description: Spread retains borrowed array iterator elements beyond the source lifetime.
features: [ts-lifetime-borrow, ts-route-iterator, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-spread]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: two iterator spreads keep the element after truncation; Node preserves both copies as one identity.
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
  const saved = [...source.values(), ...source.values()];
  source.length = 0;
  churn(n);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
