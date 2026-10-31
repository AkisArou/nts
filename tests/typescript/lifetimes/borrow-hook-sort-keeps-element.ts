/*---
description: A sort comparator can retain an element borrowed from the sorted array.
features: [ts-lifetime-borrow, ts-route-hook, ts-functions, ts-iteration, ts-objects, ts-arrays, ts-strings, ts-closures]
---*/
// Fact: reads borrow while their owner is alive (docs/foundations/memory.md, "Where nts stands").
// Route: the comparator saves its lower element before the array is cleared; Node keeps its identity.
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
  const source = [make(n + 1), make(n)];
  const saved: Cell[] = [];
  source.sort((a, b) => {
    const lower = a.id < b.id ? a : b;
    saved[0] = lower;
    saved[1] = lower;
    return a.id - b.id;
  });
  source.length = 0;
  churn(n);
  check(saved[0], saved[1], n);
}
